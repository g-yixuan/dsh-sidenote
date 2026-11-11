import { elementOf, NON_QUOTE, quoteNodeVisible } from './dom.ts'
import type { DocumentSource } from '../annotations/document.ts'

const BUILTIN = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/'
const BODIES: Readonly<Record<string, string>> = {
  markdown: '[data-document-markdown]', text: '[data-textpreview-plain]',
  code: '[data-code-preview] [data-code-block-content]', pdf: '[data-pdf-preview]', office: '[data-pdf-preview]',
}

/** Pinned 0.2.2 preview DOM and workspace-path URI grammar; no third-party renderers. */
export function documentRegionOf(range: Range, currentSessionId: string) {
  const start = elementOf(range.startContainer), end = elementOf(range.endContainer)
  const preview = start?.closest<HTMLElement>('[data-document-preview][data-textpreview-url]')
  if (!preview || end?.closest('[data-document-preview][data-textpreview-url]') !== preview) return undefined
  const sidebar = preview.closest<HTMLElement>('[data-sidebar-right-session]')
  if (!currentSessionId || sidebar?.dataset.sidebarRightSession !== currentSessionId || !quoteNodeVisible(preview)) return undefined
  // Geometry belongs to this tab; a neighbouring side-chat composer must not clip it.
  const view = preview.closest<HTMLElement>('[data-sidebar-right-tab]') ?? preview
  const renderer = preview.dataset.documentPreview!
  const kind = renderer.startsWith(BUILTIN) ? renderer.slice(BUILTIN.length) : ''
  const selector = BODIES[kind]
  const body = selector ? preview.querySelector<HTMLElement>(selector) : null
  if (!body?.contains(range.startContainer) || !body.contains(range.endContainer)) return undefined
  const address = preview.dataset.textpreviewUrl!
  const match = /^dsh-resource:\/\/file\/session\/([^/]+)\/([^?#]*)/.exec(address)
  if (!match) return undefined
  let source: DocumentSource
  try {
    source = { sessionId: decodeURIComponent(match[1]!), path: match[2]!.split('/').map(decodeURIComponent).join('/') }
  } catch { return undefined }
  if (!source.path.trim() || !source.sessionId) return undefined
  return { preview, view, body, address, source, pdf: kind === 'pdf' || kind === 'office' }
}

/** Code banners/line-number decorations are omitted; PDF status chrome is never text. */
export function documentTextAllowed(node: Text, pdf: boolean): boolean {
  const element = node.parentElement
  if (!element || element.closest(NON_QUOTE) || !quoteNodeVisible(node)) return false
  if (getComputedStyle(element).userSelect === 'none') return false
  return !pdf || element.closest('[data-pdf-text]') !== null
}
