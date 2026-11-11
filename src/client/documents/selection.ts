import { documentRegionOf, documentTextAllowed } from '../host/documents.ts'
import { quoteNodeVisible } from '../host/dom.ts'
import { selectedQuoteText } from '../annotations/source.ts'

export function captureDocumentSelection(sessionId: string) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  const region = documentRegionOf(range, sessionId)
  if (!region) return null
  const walker = document.createTreeWalker(region.body, NodeFilter.SHOW_TEXT)
  const pieces: string[] = [], pages: number[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(node) || !quoteNodeVisible(node)) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    const text = node.data.slice(start, end)
    if (!text) continue
    if (!documentTextAllowed(node, region.pdf)) {
      if (region.pdf && text.trim() && !node.parentElement?.closest('[data-pdf-text]')) return null
      continue
    }
    pieces.push(text)
    if (region.pdf && text.trim()) {
      const page = Number(node.parentElement?.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage)
      if (!Number.isSafeInteger(page) || page < 1) return null
      pages.push(page)
    }
  }
  const projected = pieces.join('')
  if (!projected.trim()) return null
  const text = selectedQuoteText(range, selection.toString(), projected)
  if (!text.trim()) return null
  return { ...region, range: range.cloneRange(), text, sessionId,
    source: { ...region.source, ...(pages.length ? { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) } : {}) } }
}

export type DocumentSelection = NonNullable<ReturnType<typeof captureDocumentSelection>>
