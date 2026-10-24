/** Main composer gestures forward controlled quotes through the native input.
 * Admission is observed on the frozen target, rather than inferred from draft clearing.
 */
import type { Context } from '../host/contracts.ts'
import { resolveInput, inputAttachmentIds } from '../host/input.ts'
export { resolveInput } from '../host/input.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { t } from '../locales.ts'
import { submitControlledInput } from '../annotations/send.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import type { ReflowStore } from '../reflow.ts'
import { submissionExtrasOf } from '../annotations/submissionExtras.ts'

import { findSendButtonInCard, isMainComposerInput, mainComposerOf, composerHasMenu, composerSessionId } from '../host/dom.ts'

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

  const currentSessionId = (seat?: HTMLElement): string => seat ? composerSessionId(seat, currentSessionIdOf(ctx)) : currentSessionIdOf(ctx)

  const hijack = (seat: HTMLElement, mode?: 'queue' | 'steer'): boolean => {
    const sessionId = currentSessionId(seat)
    if (sessionId === '') return false
    const active = store.listActive(sessionId)
    const reflows = reflow.list(sessionId)
    const extras = submissionExtrasOf(sessionId)
    const prefix = extras?.firstSendPrefix()
    if (active.length === 0 && reflows.length === 0 && !prefix) return false
    const input = resolveInput(ctx, sessionId)
    if (input === undefined) {
      store.setSubmission(sessionId, { pending: false, error: t('inputUnavailable') })
      return true
    }
    const snap = input.state.getSnapshot()
    const draft = snap.draft
    if (active.length === 0 && reflows.length === 0 && draft.trim() === '' && inputAttachmentIds(input).length === 0) return false
    if (draft.trimStart().startsWith('/')) return false
    // 机器相位守卫：claimed/adjudicating/submitting = 弹窗/命令/事务在走。
    if (snap.phase !== 'plain') return false
    // 弹窗 DOM 守卫：@引用 listbox、「+」菜单展开等。
    if (composerHasMenu(seat)) return false

    // 同步拦截成立，异步执行（inject 的有界等待不能在同步手势里）。
    committingSessions.add(sessionId)
    void submitControlledInput(ctx, store, reflow, sessionId, mode).finally(() => { committingSessions.delete(sessionId) })
    return true
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    // Scoped native input markers also cover nested Lexical reference nodes.
    if (!isMainComposerInput(target)) return
    const seat = mainComposerOf(target as Element)!
    if (event.isComposing || event.keyCode === 229) return
    if ((committingSessions.has(currentSessionId(seat)) || store.getSubmission(currentSessionId(seat)).pending)) {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    if (!hijack(seat, event.metaKey || event.ctrlKey ? 'steer' : undefined)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const seat = mainComposerOf(target)
    if (seat === null) return
    const button = target.closest('button')
    // 尾随 click：必须先于按钮识别吞掉（见 armSwallow），否则宿主按「停止」处理。
    if (swallowNextClick && button === findSendButtonInCard(seat)) {
      clearSwallow()
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (button === null) return
    if (button !== findSendButtonInCard(seat)) return
    // Preserve native Stop while admission is in flight, too.
    if (ctx.sessions.binding(currentSessionId(seat))?.session.getSnapshot().running === true && resolveInput(ctx, currentSessionId(seat))?.state.getSnapshot().draft.trim() === '') return
    if (committingSessions.has(currentSessionId(seat))) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    // 识别面收窄到卡片内末位按钮（goal bar 在 card 外、不构成误点）；
    // 运行态主按钮是「停止」——相位守卫已在 hijack 内（plain 才拦）。
    if (!hijack(seat)) return
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
    const seat = mainComposerOf(target)
    if (seat === null) return
    const button = target.closest('button')
    if (!(button instanceof HTMLButtonElement)) return
    if (!button.disabled) return
    if (button !== findSendButtonInCard(seat)) return
    if (committingSessions.has(currentSessionId(seat))) return
    // disabled 的成因必须是空草稿：离线/无模型等其它成因不属本拦截器授权范围。
    const sessionId = currentSessionId(seat)
    if (sessionId === '') return
    const input = resolveInput(ctx, sessionId)
    if (input === undefined || input.state.getSnapshot().draft.trim() !== '') return
    if (!hijack(seat)) return
    // 同一次手势的 click 紧随其后，而主按钮此刻已变身「停止」——吞掉这一发。
    armSwallow()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    clearSwallow()
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
  }
}
