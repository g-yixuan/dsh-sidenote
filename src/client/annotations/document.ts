import { t } from '../locales.ts'
import { decodeXml, xmlAttr, xmlText } from '../protocol.ts'

/** Source metadata belongs to a captured excerpt, never to a live document anchor. */
export interface DocumentLocation {
  readonly path: string
  readonly pageStart?: number
  readonly pageEnd?: number
}

export interface DocumentSource extends DocumentLocation {
  readonly sessionId: string
}

export function readDocumentLocation(value: unknown): DocumentLocation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  if (typeof source.path !== 'string' || !source.path.trim()) return undefined
  if (source.pageStart !== undefined || source.pageEnd !== undefined) {
    if (!Number.isSafeInteger(source.pageStart) || !Number.isSafeInteger(source.pageEnd)
      || (source.pageStart as number) < 1 || (source.pageEnd as number) < (source.pageStart as number)) return undefined
  }
  return { path: source.path,
    ...(source.pageStart !== undefined ? { pageStart: source.pageStart as number, pageEnd: source.pageEnd as number } : {}) }
}

export function readDocumentSource(value: unknown): DocumentSource | undefined {
  const location = readDocumentLocation(value)
  const sessionId = (value as Partial<DocumentSource> | null)?.sessionId
  return location && typeof sessionId === 'string' && sessionId ? { ...location, sessionId } : undefined
}

export function documentSourceLabel(source: DocumentLocation): string {
  const name = source.path.split(/[\\/]/).at(-1) || source.path
  return source.pageStart === undefined ? name : `${name} · ${t(source.pageStart === source.pageEnd ? 'documentPage' : 'documentPages', { start: source.pageStart, end: source.pageEnd ?? source.pageStart })}`
}

export interface DocumentQuote { readonly id: number; readonly quote: string; readonly document: DocumentLocation }

export function formatDocumentQuote(id: number, text: string, source: DocumentLocation): string {
  const pages = source.pageStart === undefined ? '' : ` page-start="${source.pageStart}" page-end="${source.pageEnd}"`
  return `<reference type="document" index="${id}" source="${xmlAttr(source.path)}"${pages}>\n<quote>${xmlText(text)}</quote>\n</reference>`
}

const DOCUMENT_RE = /<document-quote id="(\d+)" session="([^"]*)" path="([^"]*)"(?: page-start="(\d+)" page-end="(\d+)")?>\s*<quote>([\s\S]*?)<\/quote>\s*<\/document-quote>/y

/** Escaped text cannot close the protocol, even when a code file contains XML. */
export function parseLegacyDocumentQuote(text: string, from: number): { quote: DocumentQuote; end: number } | undefined {
  DOCUMENT_RE.lastIndex = from
  const match = DOCUMENT_RE.exec(text)
  if (!match) return undefined
  const document = readDocumentSource({ sessionId: decodeXml(match[2]!), path: decodeXml(match[3]!),
    ...(match[4] ? { pageStart: Number(match[4]), pageEnd: Number(match[5]) } : {}) })
  if (!document || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) return undefined
  return { quote: { id: Number(match[1]), quote: decodeXml(match[6]!), document }, end: DOCUMENT_RE.lastIndex }
}
