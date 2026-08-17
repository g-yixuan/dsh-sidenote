/**
 * Badge anchoring (Workitem 02): resolve a live DOM Range for an annotation.
 *
 * The range captured at creation time dies when React re-renders the message
 * (session switch, streaming rebuilds, fork/delete). We therefore re-anchor
 * on demand: find the message element by `data-chat-anchor-key`, locate the
 * Nth occurrence of the anchor text in its text nodes, and rebuild the range.
 * Anchor loss is acceptable (页面级临时语义) — the badge simply skips a
 * render; nothing here may throw into the page.
 */
import type { Annotation } from './model.ts'

/** The badge anchor point: right edge of the selection rects, first-line height. */
export interface BadgeAnchor {
  /** max(rect.right) across the selection's client rects. */
  readonly right: number
  /** Vertical center of the FIRST line's rect. */
  readonly centerY: number
}

/** Find the message element for an anchor key (connected DOM only). */
function findAnchorElement(anchorKey: string): HTMLElement | null {
  try {
    const el = document.querySelector<HTMLElement>(
      `[data-chat-anchor-key="${CSS.escape(anchorKey)}"]`,
    )
    return el !== null && el.isConnected ? el : null
  } catch {
    return null
  }
}

/**
 * Rebuild a range covering the `occurrence`-th appearance of `text` inside
 * `root`'s text nodes. Falls back to the LAST occurrence when the ordinal is
 * out of range（消息内容变短时，最后一次出现更可能是原选区）.
 */
function rangeOfOccurrence(root: HTMLElement, text: string, occurrence: number): Range | null {
  if (text === '') return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const haystack = root.textContent ?? ''
  let start = -1
  let at = haystack.indexOf(text)
  let seen = 0
  while (at !== -1) {
    if (seen === occurrence) { start = at; break }
    seen += 1
    at = haystack.indexOf(text, at + text.length)
  }
  if (start === -1 && occurrence > 0) {
    // Ordinal out of range — fall back to the last known occurrence.
    start = haystack.lastIndexOf(text)
  }
  if (start === -1) return null
  const end = start + text.length
  let offset = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = (node.textContent ?? '').length
    const next = offset + length
    if (startNode === null && start < next) {
      startNode = node as Text
      startOffset = start - offset
    }
    if (startNode !== null && end <= next) {
      endNode = node as Text
      endOffset = end - offset
      break
    }
    offset = next
  }
  if (startNode === null || endNode === null) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

/**
 * Resolve a live range for an annotation: the cached range while its nodes
 * are still connected, otherwise a re-anchored one (cached on success).
 * Returns null when the anchor is gone — callers skip rendering, never throw.
 */
export function resolveRange(annotation: Annotation, cache: Map<number, Range>): Range | null {
  try {
    const cached = cache.get(annotation.id)
    if (cached !== undefined && cached.startContainer.isConnected) return cached
    cache.delete(annotation.id)
    if (annotation.anchorKey === undefined || annotation.anchorText === '') return null
    const anchor = findAnchorElement(annotation.anchorKey)
    if (anchor === null) return null
    const range = rangeOfOccurrence(anchor, annotation.anchorText, annotation.occurrence)
    if (range !== null) cache.set(annotation.id, range)
    return range
  } catch {
    return null
  }
}

/**
 * The badge anchor point of a range: 选区矩形右缘 (max right edge across
 * client rects — the message column's right edge for full-line selections,
 * the selection's text end for inline ones) at 选区首行高度 (first rect's
 * vertical center). Null when the range lays out to nothing.
 */
export function badgeAnchorOf(range: Range): BadgeAnchor | null {
  try {
    const rects = range.getClientRects()
    if (rects.length === 0) return null
    let right = -Infinity
    for (const rect of rects) right = Math.max(right, rect.right)
    const first = rects[0]
    if (first === undefined || !Number.isFinite(right)) return null
    return { right, centerY: first.top + first.height / 2 }
  } catch {
    return null
  }
}

/** Client rects of a range for the active-highlight overlay (empty on failure). */
export function highlightRectsOf(range: Range): readonly { left: number; top: number; width: number; height: number }[] {
  try {
    const out: { left: number; top: number; width: number; height: number }[] = []
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0 || rect.height <= 0) continue
      out.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    return out
  } catch {
    return []
  }
}

/** 角标碰撞半径（px）：同点位的角标必须错开才可点击。 */
export const BADGE_COLLISION_RADIUS = 18
/** 碰撞时向下错开的步长（px，大于角标直径）。 */
export const BADGE_SPREAD_STEP = 24

/**
 * 角标落点错开：与已放置角标（|Δx|、|Δy| 均小于碰撞半径）冲突时按
 * BADGE_SPREAD_STEP 逐级下移——同一选区/相邻行的多个注释角标不再叠罗汉
 * （叠放时上层角标拦截下层角标的点击）。
 */
export function spreadBadgePoint(
  point: { x: number; y: number },
  placed: readonly { x: number; y: number }[],
): { x: number; y: number } {
  let out = point
  for (let guard = 0; guard < 50; guard++) {
    const collides = placed.some(p => Math.abs(p.x - out.x) < BADGE_COLLISION_RADIUS && Math.abs(p.y - out.y) < BADGE_COLLISION_RADIUS)
    if (!collides) return out
    out = { x: out.x, y: out.y + BADGE_SPREAD_STEP }
  }
  return out
}
