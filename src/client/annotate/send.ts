/** Main composer gestures forward controlled quotes through the native input.
 * Admission is observed on the frozen target, rather than inferred from draft clearing.
 */
import type { Context, SessionId, SessionInput } from '../host/contracts.ts'
import { resolveInput, inputAttachmentIds } from '../host/input.ts'
export { resolveInput } from '../host/input.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { submitAnnotations } from '../annotations/send.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import { buildReflowBlock, tryInjectReflows, type ReflowStore } from '../reflow.ts'

/** 主 composer 的宿主容器（侧边面板 textarea 不在其中，天然不串）。 */
function composerSeat(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-seat]')
}

/** 发送按钮 = [data-composer-card] 内 DOM 序最后一个 button（仅 click 路径用，
 *  且只在非运行态作为识别面——运行态主按钮变身「停止」，整个 click 路径不拦）。 */
function findSendButtonInCard(): HTMLButtonElement | null {
  const card = document.querySelector<HTMLElement>('[data-composer-card]')
  if (card === null) return null
  const buttons = card.querySelectorAll('button')
  const last = buttons[buttons.length - 1]
  return last instanceof HTMLButtonElement ? last : null
}

export function installSendInterceptor(ctx: Context, store: AnnotationStore, reflow: ReflowStore): () => void {
  /** 重入/连按护栏：事务进行中吞掉命中识别面的 Enter/点击（不重复驱动）。 */
  const committingSessions = new Set<string>()

  /**
   * 手势尾随 click 的一次性吞并。pointerdown 提交后，同一次点击的 click 仍会
   * 到达，而此时宿主主按钮已按 `primaryStops = running && empty` 变身「停止」
   * ——放行它会立刻 `stop()` 掉刚发起的这一轮（表现：assistant/attempt 空流、
   * 缺 turn/end、且没有任何错误提示）。只吞这一发，并带兜底超时。
   */
  let swallowNextClick = false
  let swallowTimer = 0
  const clearSwallow = (): void => {
    swallowNextClick = false
    window.clearTimeout(swallowTimer)
  }
  const armSwallow = (): void => {
    swallowNextClick = true
    window.clearTimeout(swallowTimer)
    // 兜底：手势没有产生 click（指针移出按钮等）时不至于吞掉后续无关点击。
    swallowTimer = window.setTimeout(clearSwallow, 2_000)
  }

  const currentSessionId = (): string => currentSessionIdOf(ctx)

  const commitAsync = async (sessionId: SessionId, input: SessionInput, reflows: ReturnType<typeof reflow.list>, active: ReturnType<typeof store.listActive>, mode?: 'queue' | 'steer'): Promise<void> => {
    try {
      const { injectedIds } = await tryInjectReflows(sessionId, reflows)
      for (const id of injectedIds) reflow.remove(id)
      const hitchhikers = reflows.filter(item => !injectedIds.has(item.id))
      if (hitchhikers.length === 0 && active.length === 0) {
        if (input.state.getSnapshot().draft.trim() !== '' || inputAttachmentIds(input).length > 0) input.submit(mode)
        return
      }
      const accepted = await submitAnnotations({
        ctx, store, sessionId, input, annotations: active,
        leadingBlocks: hitchhikers.map(item => buildReflowBlock(item)), mode,
      })
      if (accepted) for (const item of hitchhikers) reflow.remove(item.id)
    } catch (error) {
      store.setSubmission(sessionId, { pending: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      committingSessions.delete(sessionId)
      const state = store.getSubmission(sessionId)
      store.setSubmission(sessionId, { ...state, pending: false })
    }
  }

  const hijack = (mode?: 'queue' | 'steer'): boolean => {
    const sessionId = currentSessionId()
    if (sessionId === '') return false
    const active = store.listActive(sessionId)
    const reflows = reflow.list(sessionId)
    if (active.length === 0 && reflows.length === 0) return false
    const input = resolveInput(ctx, sessionId)
    if (input === undefined) return false
    const snap = input.state.getSnapshot()
    const draft = snap.draft
    if (draft.trimStart().startsWith('/')) return false
    // 机器相位守卫：claimed/adjudicating/submitting = 弹窗/命令/事务在走。
    if (snap.phase !== 'plain') return false
    // 弹窗 DOM 守卫：@引用 listbox、「+」菜单展开等。
    const seat = composerSeat()
    if (seat === null) return false
    if (seat.querySelector('[role="listbox"]') !== null) return false
    if (seat.querySelector('[aria-expanded="true"]') !== null) return false

    // 同步拦截成立，异步执行（inject 的有界等待不能在同步手势里）。
    committingSessions.add(sessionId)
    store.setSubmission(sessionId, { pending: true })
    void commitAsync(sessionId, input, reflows, active, mode)
    return true
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    // 0.1.2 兼容（W00-send-intercept-012）：宿主 composer 从受控 <textarea>
    // 重写为 Lexical contenteditable（div[data-composer-input]，Enter 走
    // Lexical command 层）。识别面双兼容：新锚点 closest 优先，旧 textarea
    // 回退；锚点 closest 天然覆盖内层 chip span/文本节点。
    const inSeat = target instanceof HTMLElement
      && (target.closest('[data-composer-input]') !== null || target instanceof HTMLTextAreaElement)
      && target.closest('[data-composer-seat]') !== null
    if (!inSeat) return
    if (event.isComposing || event.keyCode === 229) return
    if (committingSessions.has(currentSessionId())) {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    if (!hijack(event.metaKey || event.ctrlKey ? 'steer' : undefined)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const seat = target.closest('[data-composer-seat]')
    if (seat === null) return
    const button = target.closest('button')
    // 尾随 click：必须先于按钮识别吞掉（见 armSwallow），否则宿主按「停止」处理。
    if (swallowNextClick && button === findSendButtonInCard()) {
      clearSwallow()
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (button === null) return
    if (button !== findSendButtonInCard()) return
    // Preserve native Stop while admission is in flight, too.
    if (ctx.sessions.binding(currentSessionId())?.session.getSnapshot().running === true) return
    if (committingSessions.has(currentSessionId())) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    // 识别面收窄到卡片内末位按钮（goal bar 在 card 外、不构成误点）；
    // 运行态主按钮是「停止」——相位守卫已在 hijack 内（plain 才拦）。
    if (!hijack()) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  /**
   * 空草稿补位：只接管「因空草稿而 disabled」的主按钮。enabled 时立即放行，
   * 正常路径仍由上面的 click 拦截负责 —— 二者以 button.disabled 互斥。
   */
  const onPointerDown = (event: PointerEvent): void => {
    // 只认主键：右键/中键的 pointerdown 同样到达 disabled 按钮（已实证），
    // 不检查会把「打开上下文菜单」误当发送手势。
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (!(button instanceof HTMLButtonElement)) return
    if (!button.disabled) return
    if (button !== findSendButtonInCard()) return
    if (committingSessions.has(currentSessionId())) return
    // disabled 的成因必须是空草稿：离线/无模型等其它成因不属本拦截器授权范围。
    const sessionId = currentSessionId()
    if (sessionId === '') return
    const input = resolveInput(ctx, sessionId)
    if (input === undefined || input.state.getSnapshot().draft.trim() !== '') return
    if (!hijack()) return
    // 同一次手势的 click 紧随其后，而主按钮此刻已变身「停止」——吞掉这一发。
    armSwallow()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
  }
}
