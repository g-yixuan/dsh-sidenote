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
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { Context, ConversationService, SessionFace, SessionInput } from '../../context-types.ts'
import { appendDraftText } from './model.ts'

const NOOP_UNSUBSCRIBE = (): void => {}

/**
 * 解析 childId 会话的 input 草稿机；任何一步缺失/抛错返回 null
 * （调用方走降级路径）。
 */
export function resolveSessionInput(ctx: Context, childId: string): SessionInput | null {
  try {
    const actx = ctx.sessions.scope(childId)
    if (actx === undefined) return null
    const conversation = ctx.get('conversation') as ConversationService | undefined
    if (conversation === undefined || conversation === null) return null
    const input = conversation.input.for(actx)
    if (input === null || input === undefined) return null
    if (typeof input.setDraft !== 'function' || typeof input.submit !== 'function') return null
    if (input.state === undefined || typeof input.state.getSnapshot !== 'function') return null
    return input
  } catch {
    return null
  }
}

/** 读草稿机的当前草稿（容错）。 */
export function readInputDraft(input: SessionInput): string {
  try {
    const draft = input.state.getSnapshot().draft
    return typeof draft === 'string' ? draft : ''
  } catch {
    return ''
  }
}

/** composer 对外脸：machine 标记实际落点（true = input 机器，false = 自绘降级）。 */
export interface Composer {
  readonly machine: boolean
  readonly draft: string
  readonly sendError: string | null
  setDraft(text: string): void
  /** 拼接一段外部文本（桥接注入的引文草稿）。 */
  appendDraft(text: string): void
  /** 发送当前草稿（空草稿 no-op）。 */
  submit(): void
}

/**
 * 面板 composer hook。机器路径：草稿住在 input 机器的 store 里（随会话持久、
 * 与主输入框同语义），submit 走机器事务（序列化/裁决/默认 sink 全在机器内）。
 * 降级路径：草稿住本地 state，发送直连 session.prompt([...], 'queue')，
 * 失败时回填草稿并报错。
 */
export function useComposer(ctx: Context, session: SessionFace | undefined, childId: string | undefined): Composer {
  // 每个 childId 解析一次：机器可用性在会话生命周期内不变。
  const input = useMemo(
    () => (childId === undefined ? null : resolveSessionInput(ctx, childId)),
    [ctx, childId],
  )

  const machineDraft = useSyncExternalStore(
    useCallback(
      (notify: () => void) => (input === null ? NOOP_UNSUBSCRIBE : input.state.subscribe(notify)),
      [input],
    ),
    () => (input === null ? '' : readInputDraft(input)),
  )
  const [localDraft, setLocalDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)

  const draft = input === null ? localDraft : machineDraft

  const setDraft = useCallback(
    (text: string): void => {
      if (input === null) setLocalDraft(text)
      else input.setDraft(text)
    },
    [input],
  )

  const appendDraft = useCallback(
    (text: string): void => {
      if (input === null) setLocalDraft(d => appendDraftText(d, text))
      else input.setDraft(appendDraftText(readInputDraft(input), text))
    },
    [input],
  )

  const submit = useCallback((): void => {
    const text = draft.trim()
    if (text === '') return
    if (input !== null) {
      // 机器路径：草稿清空、发送失败回填、通知条全由机器/sink 负责。
      input.submit()
      return
    }
    if (session === undefined) return
    setLocalDraft('')
    setSendError(null)
    session.prompt([{ type: 'text', text }], 'queue').then((result) => {
      const r = result as { ok?: boolean; error?: { message?: string } } | undefined
      if (r !== undefined && r.ok === false) {
        // 仅在用户未另行输入时回填，不盖掉新草稿。
        setLocalDraft(d => (d === '' ? text : d))
        setSendError(r.error?.message ?? '发送失败')
      }
    }).catch((error: unknown) => {
      setLocalDraft(d => (d === '' ? text : d))
      setSendError(error instanceof Error ? error.message : '发送失败')
    })
  }, [draft, input, session])

  return { machine: input !== null, draft, sendError, setDraft, appendDraft, submit }
}
