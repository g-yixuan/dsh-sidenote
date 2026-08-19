/**
 * Selection capture layer (Workitem 02): document-level listeners validate
 * the live selection and publish the latest valid one to the floating
 * toolbar through a small external-store controller. Mirrors the
 * production-proven dsh-sidebar-qa contract, narrowed to assistant messages:
 *
 * - both selection endpoints must sit in the SAME `[data-chat-flow-kind=
 *   "assistant-step"]` message node (跨消息划选不弹);
 * - `[data-streaming]` messages (still streaming) are excluded;
 * - `[data-dsh-better-sidebar]` and our own `[data-dsh-sidechat]` DOM are
 *   excluded (与侧边栏 viewer 浮层互斥);
 * - the text must be non-blank; over-length selections are admitted with the
 *   quote truncated (见 format.ts), never rejected.
 *
 * These are DSH-internal DOM attributes rather than a public contract — an
 * upstream redesign silently degrades the feature (no popup), never crashes.
 */
import { truncateQuote } from './format.ts'

/** One validated selection, ready for the toolbar. */
export interface SelectionSnapshot {
  /** Truncated quote (sent to the model / stored on the annotation). */
  readonly text: string
  /** Full selection text (re-anchor needle). */
  readonly anchorText: string
  /** `data-chat-anchor-key` of the owning message, when present. */
  readonly anchorKey: string | undefined
  /** 0-based ordinal of this selection among identical texts in the anchor. */
  readonly occurrence: number
  /** Bounding box for toolbar placement. */
  readonly rect: { readonly left: number; readonly top: number; readonly width: number }
  /** A live clone of the selection range (badge anchor until re-render). */
  readonly range: Range
  readonly sessionId: string
}

export interface SelectionState {
  readonly selection: SelectionSnapshot | null
}

/** The assistant message node kind (v1 实测纠正值 — 勿引旧值 `assistant`). */
export const ASSISTANT_KIND = 'assistant-step'

/** Selector roots our UI must never react to (sidebar viewer + our own root). */
const EXCLUDED_ROOTS = '[data-dsh-better-sidebar], [data-dsh-sidechat]'

/** Pure validation of one candidate selection (unit-tested without DOM). */
export function isEligibleSelection(input: {
  readonly blank: boolean
  readonly sameMessage: boolean
  readonly kind: string
  readonly streaming: boolean
  readonly excluded: boolean
  readonly hasSession: boolean
}): boolean {
  return !input.blank
    && input.sameMessage
    && input.kind === ASSISTANT_KIND
    && !input.streaming
    && !input.excluded
    && input.hasSession
}

/** Resolve the assistant message element owning a DOM node (text nodes → parent). */
function messageOf(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  if (element === null || typeof element.closest !== 'function') return null
  return element.closest<HTMLElement>(`[data-chat-flow-kind="${ASSISTANT_KIND}"]`)
}

/** Whether the message is still streaming (unfinished). */
function isStreaming(message: HTMLElement): boolean {
  return message.hasAttribute('data-streaming') || message.querySelector('[data-streaming]') !== null
}

/**
 * The 0-based ordinal of the selection's text among its occurrences in the
 * anchor element — the disambiguator for repeated phrases (re-anchor key).
 */
export function occurrenceOf(anchor: HTMLElement, range: Range, text: string): number {
  try {
    const pre = document.createRange()
    pre.selectNodeContents(anchor)
    pre.setEnd(range.startContainer, range.startOffset)
    const before = pre.toString()
    let occurrence = 0
    let at = before.indexOf(text)
    while (at !== -1) {
      occurrence += 1
      at = before.indexOf(text, at + text.length)
    }
    return occurrence
  } catch {
    return 0
  }
}

/** Capture and validate the current window selection, or null when invalid. */
export function captureSelection(currentSessionId: string): SelectionSnapshot | null {
  const sel = window.getSelection()
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
  const anchorText = sel.toString()
  const range = sel.getRangeAt(0)
  const startMessage = messageOf(range.startContainer)
  const endMessage = messageOf(range.endContainer)
  const message = startMessage
  const anchor = message?.closest<HTMLElement>('[data-chat-anchor-key]') ?? null
  const eligible = isEligibleSelection({
    blank: anchorText.trim() === '',
    sameMessage: message !== null && message === endMessage,
    kind: message?.dataset.chatFlowKind ?? '',
    streaming: message !== null && isStreaming(message),
    excluded: anchor !== null
      ? anchor.closest(EXCLUDED_ROOTS) !== null
      : message?.closest(EXCLUDED_ROOTS) !== null,
    hasSession: currentSessionId !== '',
  })
  if (!eligible || message === null) return null
  const rect = range.getBoundingClientRect()
  return {
    text: truncateQuote(anchorText),
    anchorText,
    anchorKey: anchor?.dataset.chatAnchorKey,
    occurrence: anchor === null ? 0 : occurrenceOf(anchor, range, anchorText),
    rect: { left: rect.left, top: rect.top, width: rect.width },
    range: range.cloneRange(),
    sessionId: currentSessionId,
  }
}

export interface SelectionController {
  getSnapshot(): SelectionState
  subscribe(fn: () => void): () => void
  clear(): void
  dispose(): void
}

/** Debounce for selectionchange (ms). */
const DEBOUNCE_MS = 200

/** Create one selection controller (call once per plugin activation). */
export function createSelectionController(getSessionId: () => string): SelectionController {
  let selection: SelectionSnapshot | null = null
  const listeners = new Set<() => void>()
  let debounceTimer: number | undefined

  // useSyncExternalStore requires a STABLE snapshot reference between
  // notifications — a fresh object each call would loop React.
  let state: SelectionState = { selection: null }

  const notify = (): void => {
    state = { selection }
    for (const fn of [...listeners]) fn()
  }

  const recompute = (): void => {
    let next: SelectionSnapshot | null = null
    try {
      next = captureSelection(getSessionId())
    } catch {
      next = null
    }
    const changed = (selection === null) !== (next === null)
      || (selection !== null && next !== null && (
        selection.anchorText !== next.anchorText
        || selection.anchorKey !== next.anchorKey
        || selection.sessionId !== next.sessionId
        || selection.rect.top !== next.rect.top
        || selection.rect.left !== next.rect.left
        || selection.rect.width !== next.rect.width
      ))
    if (!changed) return
    selection = next
    notify()
  }

  const onSelectionChange = (): void => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(recompute, DEBOUNCE_MS)
  }

  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('mouseup', recompute)
  document.addEventListener('keyup', onSelectionChange)

  return {
    getSnapshot: () => state,
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    clear(): void {
      selection = null
      notify()
    },
    dispose(): void {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', recompute)
      document.removeEventListener('keyup', onSelectionChange)
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    },
  }
}
