/** Internal conversation DOM seams, validated by the pinned host journeys.
 * Main message markers and composer seats have no public replacement API. */
export const MAIN_ASSISTANT = '[data-chat-flow-kind="assistant-step"]'
export const NON_QUOTE = 'button, [role="button"], input, textarea, select, [contenteditable="true"], [data-code-block-banner], [data-sidenote-no-quote]'

export function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

export function mainMessageOf(node: Node, currentSessionId: string) {
  const body = elementOf(node)?.closest<HTMLElement>(MAIN_ASSISTANT)
  if (body === undefined || body === null) return null
  const conversation = body.closest<HTMLElement>('[data-conversation-session]')
  const sessionId = conversation?.dataset.conversationSession ?? currentSessionId
  if (sessionId === '') return null
  const anchor = body.closest<HTMLElement>('[data-chat-anchor-key]') ?? body
  return {
    body, view: conversation ?? document.body,
    anchor, key: anchor.dataset.chatAnchorKey,
    sessionId, surface: 'main' as const,
    streaming: body.hasAttribute('data-streaming') || body.querySelector('[data-streaming]') !== null,
  }
}

export function mainAnchorBodies(sessionId: string, anchorKey: string, currentSessionId: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(MAIN_ASSISTANT)].filter(body => {
    const source = mainMessageOf(body, currentSessionId)
    return source?.sessionId === sessionId && source.key === anchorKey
      && body.closest('[data-dsh-better-sidebar], [data-sidenote-chat-session]') === null
  })
}

/** Intersect every clipping ancestor, then exclude this view's composer. */
export function quoteClipOf(body: HTMLElement, view: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  let clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (let parent = body.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const rect = parent.getBoundingClientRect()
    if (parent === view || /auto|scroll|hidden|clip/.test(style.overflowX + style.overflowY)) {
      if (rect.width > 0 && rect.height > 0) clip = {
        left: Math.max(clip.left, rect.left), top: Math.max(clip.top, rect.top),
        right: Math.min(clip.right, rect.right), bottom: Math.min(clip.bottom, rect.bottom),
      }
    }
  }
  const composer = view.querySelector<HTMLElement>(view.hasAttribute('data-sidenote-chat-session') ? '[data-sidenote-composer]' : '[data-composer-seat]')?.getBoundingClientRect()
  if (composer !== undefined && composer.width > 0 && composer.left < clip.right && composer.right > clip.left) clip.bottom = Math.min(clip.bottom, composer.top)
  return clip
}

export function mainComposerOf(node: Element): HTMLElement | null { return node.closest<HTMLElement>('[data-composer-seat]') }

export function focusMainComposer(view: HTMLElement): void {
  view.querySelector<HTMLElement>('[data-composer-seat] [data-composer-input], [data-composer-seat] textarea')?.focus()
}

/** 主 composer 的宿主容器（侧边面板 textarea 不在其中，天然不串）。 */
export function composerSeat(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-seat]')
}

/** 发送按钮 = [data-composer-card] 内 DOM 序最后一个 button（仅 click 路径用，
 *  且只在非运行态作为识别面——运行态主按钮变身「停止」，整个 click 路径不拦）。 */
export function findSendButtonInCard(): HTMLButtonElement | null {
  const card = document.querySelector<HTMLElement>('[data-composer-card]')
  if (card === null) return null
  const buttons = card.querySelectorAll('button')
  const last = buttons[buttons.length - 1]
  return last instanceof HTMLButtonElement ? last : null
}


export function isMainComposerInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.closest('[data-composer-input]') !== null || target instanceof HTMLTextAreaElement)
    && mainComposerOf(target) !== null
}

export function composerHasMenu(seat: HTMLElement): boolean {
  return seat.querySelector('[role="listbox"], [aria-expanded="true"]') !== null
}

export function hasConversationMessages(): boolean {
  return document.querySelector('[data-chat-flow-kind]') !== null
}
