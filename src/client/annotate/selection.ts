/** Selection previews visit only selected content; durable anchors are resolved on action. */
import { quoteSourcesOfRange, quoteRangeOf, projectedRangeText, selectedQuoteText, sourceKey, type QuoteSource } from '../annotations/source.ts'
import type { AnnotationAnchor } from '../annotations/model.ts'

/** Lightweight toolbar state. No preceding message text or occurrence count is read. */
export interface SelectionPreview {
  readonly text: string
  readonly anchorText: string
  readonly anchorKey: string | undefined
  readonly rect: { readonly left: number; readonly top: number; readonly width: number }
  readonly range: Range
  readonly ranges: readonly Range[]
  readonly sources: readonly QuoteSource[]
  readonly sessionId: string
  readonly source: QuoteSource
}

/** A committed quote, including the positions needed to restore its badges. */
export interface SelectionSnapshot extends SelectionPreview {
  readonly occurrence: number
  readonly anchors?: readonly AnnotationAnchor[]
}

export interface SelectionState { readonly selection: SelectionPreview | null }

/** Count earlier non-overlapping occurrences using the same projection as restoration. */
export function occurrenceOf(anchor: HTMLElement, range: Range, text: string): number {
  const pre = document.createRange()
  pre.selectNodeContents(anchor)
  pre.setEnd(range.startContainer, range.startOffset)
  const before = projectedRangeText(anchor, pre)
  let occurrence = 0
  for (let at = before.indexOf(text); at !== -1; at = before.indexOf(text, at + text.length)) occurrence += 1
  return occurrence
}

function previewRange(range: Range, currentSessionId: string, browserText: string): SelectionPreview | null {
  if (range.collapsed || !range.startContainer.isConnected || !range.endContainer.isConnected) return null
  const sources = quoteSourcesOfRange(range, currentSessionId)
  if (!sources) return null
  const ranges: Range[] = []
  const texts: string[] = []
  for (const source of sources) {
    const fragment = quoteRangeOf(source.body, range)
    if (!fragment) return null
    ranges.push(fragment)
    texts.push(projectedRangeText(source.body, fragment))
  }
  const anchorText = texts.join('')
  if (anchorText.trim() === '') return null
  const text = browserText.replace(/\s/g, '') === anchorText.replace(/\s/g, '') ? browserText
    : ranges.map((fragment, index) => selectedQuoteText(fragment, fragment.toString(), texts[index]!)).join('\n\n')
  const source = sources[0]!
  const rect = range.getBoundingClientRect()
  return { text, anchorText, anchorKey: sourceKey(source), sources, source, ranges,
    range: range.cloneRange(), sessionId: source.sessionId,
    rect: { left: rect.left, top: rect.top, width: rect.width } }
}

/** Validate the selected region and capture placement without scanning the rest of a reply. */
export function previewSelection(currentSessionId: string): SelectionPreview | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  return previewRange(selection.getRangeAt(0), currentSessionId, selection.toString())
}

/** Revalidate the frozen range before an action; DOM replacement never quotes a different passage. */
export function resolveSelection(preview: SelectionPreview): SelectionSnapshot | null {
  const current = previewRange(preview.range, preview.sessionId, preview.text)
  if (!current || current.anchorText !== preview.anchorText || current.sources.length !== preview.sources.length
    || current.sources.some((source, index) => {
      const original = preview.sources[index]!
      return source.body !== original.body || source.view !== original.view || source.sessionId !== original.sessionId
        || source.surface !== original.surface || sourceKey(source) !== sourceKey(original) || source.turn !== original.turn
    })) return null
  const anchors = current.sources.map((source, index) => {
    const range = current.ranges[index]!
    const anchorText = projectedRangeText(source.body, range)
    return { anchorKey: sourceKey(source), anchorText, occurrence: occurrenceOf(source.body, range, anchorText) }
  })
  return { ...current, occurrence: anchors[0]!.occurrence, ...(anchors.length > 1 ? { anchors } : {}) }
}

/** Capture a complete quote directly for callers that are already committing an action. */
export function captureSelection(currentSessionId: string): SelectionSnapshot | null {
  const preview = previewSelection(currentSessionId)
  return preview && resolveSelection(preview)
}

export interface SelectionController {
  getSnapshot(): SelectionState
  subscribe(fn: () => void): () => void
  clear(): void
  dispose(): void
}

function sameRange(a: Range, b: Range): boolean {
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer && a.endOffset === b.endOffset
}

/** Native dragging stays untouched. Release publishes synchronously; keyboard/touch changes share one frame. */
export function createSelectionController(getSessionId: () => string): SelectionController {
  let state: SelectionState = { selection: null }
  let dragging = false
  let paused = false
  let disposed = false
  let frame = 0
  const listeners = new Set<() => void>()
  const publish = (selection: SelectionPreview | null): void => {
    if (disposed || (selection === null && state.selection === null)) return
    state = { selection }
    for (const listener of [...listeners]) listener()
  }
  const cancelFrame = (): void => { if (frame) { window.cancelAnimationFrame(frame); frame = 0 } }
  const clear = (): void => { cancelFrame(); publish(null) }
  const recompute = (): void => {
    cancelFrame()
    if (disposed || dragging || paused) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) { publish(null); return }
    // selectionchange commonly follows pointerup for the identical native range.
    if (state.selection && sameRange(state.selection.range, selection.getRangeAt(0))) return
    try { publish(previewSelection(getSessionId())) } catch { publish(null) }
  }
  const selectionChanged = (): void => {
    if (dragging || disposed || paused) return
    if (window.getSelection()?.isCollapsed) { clear(); return }
    if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; recompute() })
  }
  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('[data-dsh-sidenote]'))) return
    paused = false
    // Touch selection handles can continue changing after pointerup.
    dragging = event.pointerType !== 'touch'
    clear()
  }
  const pointerUp = (): void => { paused = false; dragging = false; recompute() }
  const cancel = (): void => { paused = true; dragging = false; clear() }
  const keyUp = (event: KeyboardEvent): void => { if (event.key === 'Escape') cancel(); else { paused = false; recompute() } }

  document.addEventListener('pointerdown', pointerDown)
  document.addEventListener('pointerup', pointerUp)
  document.addEventListener('pointercancel', cancel)
  document.addEventListener('selectionchange', selectionChanged)
  document.addEventListener('keyup', keyUp)
  window.addEventListener('blur', cancel)
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    clear,
    dispose() {
      disposed = true
      cancelFrame()
      document.removeEventListener('pointerdown', pointerDown)
      document.removeEventListener('pointerup', pointerUp)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('selectionchange', selectionChanged)
      document.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', cancel)
      listeners.clear()
    },
  }
}
