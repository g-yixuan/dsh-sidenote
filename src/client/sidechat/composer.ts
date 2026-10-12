/**
 * 侧边聊天 composer 的状态层：优先复用会话 input 机器（草稿机），
 * 拿不到时整体降级为本地草稿 + session.prompt。
 *
 * 机器路径（dsh-better-sidebar src/client/conversation-draft.ts 同款惰性模式）：
 *   ctx.sessions.scope(childId) 取会话 scope ctx
 *   → ctx.get('conversation') 惰性取会话服务
 *   → conversation.input.for(actx) 取该会话的 SessionInput 草稿机
 *     （draft 读写 / submit / notify 全在这张脸上）。
 *
 * 已知风险（design.md 已标注的 spike 点）：InputHub 的 shell 由 sessions
 * provide materialization 触发创建，「从未 staged 的会话 scope」可能没有
 * resident shell —— 任何一步失败都降级，绝不崩面板。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Context, SessionFace, SessionInput } from '../host/contracts.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import { submitAnnotations } from '../annotations/send.ts'
import { resolveInput, probeInput, readInputDraft, inputAttachmentIds, removeInputAttachment } from '../host/input.ts'
export { readInputDraft } from '../host/input.ts'
import { appendDraftText } from './model.ts'
import { attachFiles, resolveAttachmentApis } from './composer/attach.ts'
import { hostDiagnostics } from '../host/probes.ts'
import { t } from '../locales.ts'

const NOOP_UNSUBSCRIBE = (): void => {}

/**
 * 解析 childId 会话的 input 草稿机；任何一步缺失/抛错返回 null
 * （调用方走降级路径）。
 */
export function resolveSessionInput(ctx: Context, childId: string): SessionInput | null {
  return resolveInput(ctx, childId) ?? null
}

/** composer 对外脸：machine 标记实际落点（true = input 机器，false = 自绘降级）。 */
export interface Composer {
  readonly machine: boolean
  readonly draft: string
  readonly sendError: string | null
  readonly canSubmit: boolean
  setDraft(text: string): void
  /** 拼接一段外部文本（桥接注入的引文草稿）。 */
  appendDraft(text: string): void
  /** 发送当前草稿（空草稿 no-op）。mode 缺省 = 机器/设置裁决（busy-Enter）。
   *  首条消息前缀由 useComposer 的 firstSendPrefix 选项注入（Delivery_04）。 */
  submit(mode?: 'queue' | 'steer'): void
  /** 斜杠/@ 触发接线需要：机器相位 + 草稿版本号（缺机器时 undefined）。 */
  readonly phase: string | undefined
  readonly draftRev: number | undefined
  /** 待发图片附件 id 列（附件 rail；缺机器时空）。 */
  readonly imageIds: readonly string[]
  /** 待发图片的预览（rail 渲染用；id + previewUrl）。 */
  readonly imagePreviews: readonly { id: string; url: string }[]
  /** 附件能力可用（机器在 + createDraftImages 面在）。 */
  readonly canAttach: boolean
  /** 选中文件挂为草稿图片；返回是否挂上。 */
  attachImages(files: readonly File[]): boolean
  /** 移除一张待发图片。 */
  removeImage(id: string): void
}

/**
 * 面板 composer hook。机器路径：草稿住在 input 机器的 store 里（随会话持久、
 * 与主输入框同语义），submit 走机器事务（序列化/裁决/默认 sink 全在机器内）。
 * 降级路径：草稿住本地 state，发送直连 session.prompt([...], 'queue')，
 * 失败时回填草稿并报错。
 *
 * firstSendPrefix：提交时获取主线进展快照；真实接受后才由 onAccepted 消费。
 * 失败时剥离临时前缀，保留正文与待发注释。
 *
 * onSubmitText（Delivery_05 内容身份）：每次 submit 拿到干净 body（不含
 * 快照前缀），供面板捕获首条消息主题为 topic；是否首条的判定归调用方。
 */
export function useComposer(ctx: Context, session: SessionFace | undefined, childId: string | undefined, options?: { annotations?: AnnotationStore; firstSendPrefix?: () => string | null; onSubmitText?: (body: string) => void; onAccepted?: () => void }): Composer {
  const diagnostics = hostDiagnostics(ctx)
  const hostState = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot)
  // 同一 child 的 retained Session 就绪后必须重解析，避免把初次缺席缓存为永久降级。
  const input = useMemo(
    () => (childId === undefined ? null : resolveSessionInput(ctx, childId)),
    [ctx, childId, session, hostState],
  )

  const machineState = useSyncExternalStore(
    useCallback(
      (notify: () => void) => (input === null ? NOOP_UNSUBSCRIBE : input.state.subscribe(notify)),
      [input],
    ),
    () => (input === null ? null : input.state.getSnapshot()),
  )
  const machineDraft = machineState?.draft ?? ''
  const [fallbackDraft, setFallbackDraft] = useState<{ id?: string; text: string }>({ id: childId, text: '' })
  const localDraft = fallbackDraft.id === childId ? fallbackDraft.text : ''
  const setLocalDraft = (update: string | ((text: string) => string)): void => {
    setFallbackDraft(current => ({ id: childId, text: typeof update === 'string' ? update : update(current.id === childId ? current.text : '') }))
  }
  const [sendError, setSendError] = useState<string | null>(null)
  const lastNativeDraft = useRef<{ id?: string; text: string; hasAttachments: boolean } | undefined>(undefined)
  if (input !== null) lastNativeDraft.current = { id: childId, text: machineDraft, hasAttachments: inputAttachmentIds(input).length > 0 }
  useEffect(() => {
    if (input === null) {
      const previous = lastNativeDraft.current
      if (previous !== undefined && previous.id === childId && previous.text !== '' && localDraft === '') setLocalDraft(previous.text)
      return
    }
    if (localDraft === '' || machineState?.phase !== 'plain') return
    if (machineDraft === '') input.setDraft(localDraft)
    else if (machineDraft !== localDraft) { setSendError(t('draftRecoveryConflict')); return }
    setLocalDraft('')
    setSendError(null)
  }, [input, childId, localDraft, machineDraft, machineState?.phase])
  useSyncExternalStore(
    useCallback((notify: () => void) => options?.annotations?.subscribe(notify) ?? NOOP_UNSUBSCRIBE, [options?.annotations]),
    () => options?.annotations?.getSnapshot() ?? 0,
  )

  const draft = input === null || localDraft !== '' ? localDraft : machineDraft

  // 附件 API（off-face 探测；一次解析，会话生命周期内不变）。
  const apis = useMemo(() => resolveAttachmentApis(ctx, childId), [ctx, childId])

  const attachImages = useCallback(
    (files: readonly File[]): boolean => {
      if (input === null || apis === null) return false
      try { return attachFiles(apis, input, files) } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error))
        return false
      }
    },
    [input, apis],
  )

  const removeImage = useCallback(
    (id: string): void => {
      if (input === null || apis === null) return
      removeInputAttachment(input, id)
      apis.releaseDraftImage(id)
    },
    [input, apis],
  )

  const setDraft = useCallback(
    (text: string): void => {
      if (input === null || localDraft !== '') setLocalDraft(text)
      else input.setDraft(text)
    },
    [input, localDraft, childId],
  )

  const appendDraft = useCallback(
    (text: string): void => {
      if (input === null || localDraft !== '') setLocalDraft(d => appendDraftText(d, text))
      else input.setDraft(appendDraftText(readInputDraft(input), text))
    },
    [input, localDraft, childId],
  )

  const submit = useCallback((mode?: 'queue' | 'steer'): void => {
    if (input !== null && childId !== undefined) {
      const current = probeInput(ctx, childId)
      if (current.input === undefined) {
        setSendError(t(current.state === 'unavailable' ? 'inputUnavailable' : 'inputWaiting'))
        return
      }
    }
    const body = draft.trim()
    const store = options?.annotations
    const active = childId === undefined ? [] : store?.listActive(childId) ?? []
    if (childId !== undefined && store?.getSubmission(childId).pending === true) return
    if (body === '' && active.length === 0 && (input === null || inputAttachmentIds(input).length === 0)) return
    const prefix = options?.firstSendPrefix?.() ?? null
    const text = prefix === null ? body : `${prefix}\n\n${body}`
    if (input !== null && localDraft !== '') { setSendError(t('draftRecoveryConflict')); return }
    if (input !== null) {
      if (store !== undefined && childId !== undefined && (active.length > 0 || prefix !== null)) {
        const target = childId
        store.setSubmission(target, { pending: true })
        setSendError(null)
        void submitAnnotations({ ctx, store, sessionId: target, input, annotations: active, leadingBlocks: prefix === null ? [] : [prefix], mode }).then(accepted => {
          const status = store.getSubmission(target)
          store.setSubmission(target, { ...status, pending: false })
          if (accepted) { options?.onSubmitText?.(body); options?.onAccepted?.() }
        })
      } else {
        try { input.submit(mode); options?.onSubmitText?.(body) }
        catch (error) { setSendError(error instanceof Error ? error.message : String(error)) }
      }
      return
    }
    const previous = lastNativeDraft.current
    if (active.length > 0 || (previous !== undefined && previous.id === childId && previous.hasAttachments)) {
      setSendError(t(childId !== undefined && probeInput(ctx, childId).state === 'unavailable' ? 'inputUnavailable' : 'inputWaiting'))
      return
    }
    if (session === undefined) return
    setLocalDraft('')
    setSendError(null)
    const restoreLocalBody = (): void => {
      setFallbackDraft(current => current.id === childId && current.text === '' ? { ...current, text: body } : current)
    }
    session.prompt([{ type: 'text', text }], mode ?? 'queue').then((result) => {
      // RpcResult 直接 ok 联合（无 .result 包装，镜像已收窄——见 contracts.ts）。
      if (result.ok === false) {
        // 仅在用户未另行输入时回填，不盖掉新草稿。
        restoreLocalBody()
        setSendError(result.error?.message ?? '发送失败')
      } else { options?.onSubmitText?.(body); options?.onAccepted?.() }
    }).catch((error: unknown) => {
      restoreLocalBody()
      setSendError(error instanceof Error ? error.message : '发送失败')
    })
  }, [draft, input, session, options, childId, ctx, localDraft])

  return {
    machine: input !== null,
    draft,
    sendError,
    canSubmit: (draft.trim() !== '' || (childId !== undefined && (options?.annotations?.countActive(childId) ?? 0) > 0) || (input !== null && inputAttachmentIds(input).length > 0))
      && (childId === undefined || options?.annotations?.getSubmission(childId).pending !== true)
      && !(input !== null && localDraft !== ''),
    setDraft,
    appendDraft,
    submit,
    phase: machineState?.phase,
    draftRev: machineState?.draftRev,
    imageIds: input === null ? [] : inputAttachmentIds(input),
    imagePreviews: (() => {
      const ids = input === null ? [] : inputAttachmentIds(input)
      if (ids.length === 0 || apis === null) return []
      try {
        return apis.draftImages(ids).map(i => ({ id: i.id, url: i.previewUrl }))
      } catch {
        return []
      }
    })(),
    canAttach: input !== null && apis !== null,
    attachImages,
    removeImage,
  }
}
