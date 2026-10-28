/** Internal conversation DOM seams, validated by the pinned host journeys.
 * Main message markers and composer seats have no public replacement API. */
export const MAIN_ASSISTANT = '[data-chat-flow-kind="assistant-step"]'
export const NON_QUOTE = 'button, [role="button"], input, textarea, select, [contenteditable="true"], [data-code-block-banner], [data-variant="think"], [data-sidenote-no-quote]'

export function nativeAssistantBodies(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(MAIN_ASSISTANT)]
}

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
  const composer = view.querySelector<HTMLElement>('[data-composer-seat], [data-sidenote-composer]')?.getBoundingClientRect()
  if (composer !== undefined && composer.width > 0 && composer.left < clip.right && composer.right > clip.left) clip.bottom = Math.min(clip.bottom, composer.top)
  return clip
}

export function mainComposerOf(node: Element): HTMLElement | null { return node.closest<HTMLElement>('[data-composer-seat]') }

export function focusMainComposer(view: HTMLElement): void {
  const inputs = [...view.querySelectorAll<HTMLElement>('[data-composer-seat] [data-composer-input], [data-composer-seat] textarea')]
  inputs.find(input => input.closest('[data-sidenote-chat-session]') === null)?.focus()
}

export function focusSideComposer(view: HTMLElement): void {
  view.querySelector<HTMLElement>('[data-composer-input], textarea')?.focus()
}

/** 主 composer 的宿主容器（侧边面板 textarea 不在其中，天然不串）。 */
export function composerSeat(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-seat]')
}

/** 发送按钮 = [data-composer-card] 内 DOM 序最后一个 button（仅 click 路径用，
 *  且只在非运行态作为识别面——运行态主按钮变身「停止」，整个 click 路径不拦）。 */
export function findSendButtonInCard(root: ParentNode = document): HTMLButtonElement | null {
  const card = root.querySelector<HTMLElement>('[data-composer-card]')
  if (card === null) return null
  const buttons = card.querySelectorAll('button:not([data-sidenote-submit])')
  const last = buttons[buttons.length - 1]
  return last instanceof HTMLButtonElement ? last : null
}

export function composerSessionId(seat: HTMLElement, fallback: string): string {
  return seat.closest<HTMLElement>('[data-sidenote-chat-session]')?.dataset.sidenoteChatSession
    ?? seat.closest<HTMLElement>('[data-conversation-session]')?.dataset.conversationSession
    ?? fallback
}

/** Bound message hover details to their native conversation pane. */
export function conversationViewOf(node: Element): HTMLElement {
  return node.closest<HTMLElement>('[data-conversation-session], [data-sidenote-chat-session]') ?? document.body
}

/** Only actual submitted/queued messages may enable a read-only context preview.
 * Search results and other non-interactive UserText consumers stay inert. */
export function isPendingContextSurface(node: Element): boolean {
  return node.closest('[data-pending-steering], [data-submission-echo], [data-queue-dock]') !== null
    && node.parentElement?.closest('button, a, [role="button"]') == null
}

/** Previous hosts have no UserText extension for their pending/queue text. */
export function pendingTextSurfaces(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-pending-steering] [class$="_bubble"], [data-submission-echo] [class$="_bubble"]')]
}

/** Row indices include an edited row whose preview is temporarily absent. */
export function queuedTextSurfaces(root: HTMLElement): { element: HTMLElement; index: number }[] {
  return [...root.querySelectorAll('[data-queue-dock] li')].flatMap((row, index) => {
    const element = row.querySelector<HTMLElement>('[class$="_preview"]')
    return element ? [{ element, index }] : []
  })
}

/** Hide only the protocol text, without moving/deleting React-owned children.
 * Attachments, native references, actions and the remaining body stay native. */
export function pendingTextNodes(element: HTMLElement): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('[data-sidenote-pending-seat]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

export function isMainComposerInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.closest('[data-composer-input]') !== null || target instanceof HTMLTextAreaElement)
    && mainComposerOf(target) !== null
}

export function composerHasMenu(seat: HTMLElement): boolean {
  return seat.querySelector('[role="listbox"], [role="menu"], [aria-haspopup][aria-expanded="true"]') !== null
}

export function hasConversationMessages(): boolean {
  return document.querySelector('[data-chat-flow-kind]') !== null
}

/** 0.2.0 has no UserText extension. Only add our own portal seat; never move
 * or replace host-owned children. The CSS-module suffix is checked by E2E. */
export function mountUserBubbleAddon(root: HTMLElement, addon: HTMLElement): () => void {
  root.querySelector<HTMLElement>('[class$="_bubble"]')?.prepend(addon)
  return () => { addon.remove() }
}
