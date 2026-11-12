import { t } from '../locales.ts'
import { decodeXml, xmlText } from '../protocol.ts'
import { buildReflowBlock, type ReflowItem } from '../reflow.ts'
import { formatDocumentQuote, parseLegacyDocumentQuote, readDocumentLocation, type DocumentSource, type DocumentQuote } from './document.ts'

/**
 * v4: one versioned prefix, with typed references and escaped full-text fields.
 * Indices match each kind's UI numbering and freeze on admission. The host owns
 * the body after this prefix; no text is truncated or rewritten in history.
 * The legacy reader below remains for already-persisted messages.
 */

export interface QuoteItem {
  readonly text: string
  readonly note: string
  /** 本条消息中的编号，与原文角标一致。 */
  readonly number?: number
  readonly sourceSurface?: 'main' | 'side'
  readonly document?: DocumentSource
}

/** One annotation's XML block（无注解时省略 <note>）。 */
export function formatAnnotationXml(index: number, item: QuoteItem): string {
  const note = item.note.trim()
  const source = item.sourceSurface === 'side' ? 'side-chat' : 'main-chat'
  return `<reference type="annotation" index="${item.number ?? index}" source="${source}">\n<quote>${xmlText(item.text)}</quote>${note ? `\n<note>${xmlText(note)}</note>` : ''}\n</reference>`
}

/** All pending kinds share one native message and one protocol envelope. */
export function buildProtocolBlock(items: readonly QuoteItem[], reflows: readonly ReflowItem[] = []): string {
  const annotations = items.filter(item => !item.document)
  const references = [
    ...reflows.map((item, i) => buildReflowBlock(item, i + 1)),
    ...items.filter(item => item.document).map((item, i) => formatDocumentQuote(item.number ?? i + 1, item.text, item.document!)),
    ...annotations.map((item, i) => formatAnnotationXml(i + 1, item)),
  ]
  return references.length ? `<sidenote-context version="4">\n<guidance>${xmlText(t('protocolGuidance'))}</guidance>\n\n${references.join('\n\n')}\n</sidenote-context>` : ''
}

// ── 反解析（气泡手术用；纯函数可测） ─────────────────────────────────────────

/** 协议头识别（zh/en 都认）：整行匹配。 */
export const PROTOCOL_HEADER_RE = /^(?:我批注了以下 (\d+) 处内容：|I annotated (\d+) passage\(s\) of the conversation above:)$/

export interface ParsedAnnotation {
  readonly id: number
  readonly quote: string
  /** '' = 无注解。 */
  readonly note: string
}

export interface ParsedRefFlow {
  readonly source: string
  readonly content: string
}

export interface ProtocolPrefix {
  /** Prefix length consumed by the host's text renderer. */
  readonly length: number
  readonly annotations: readonly ParsedAnnotation[]
  readonly reflows: readonly ParsedRefFlow[]
  readonly documents?: readonly DocumentQuote[]
}

const ANNOTATION_RE = /<annotation id="(\d+)"(?: local="(\d+)")?(?: scope="[^"]*")?>\s*<quote>([\s\S]*?)<\/quote>\s*(?:<note>([\s\S]*?)<\/note>\s*)?<\/annotation>/y
const REFLOW_RE = /<reflow\s+source="([^"]*)"(?:\s+reason="([^"]*)")?\s*>([\s\S]*?)<\/reflow>/y
const REFERENCE_RE = /<reference type="(document|annotation|reflow)" index="(\d+)" source="([^"]*)"(?: page-start="(\d+)" page-end="(\d+)")?>\s*([\s\S]*?)<\/reference>/y
const QUOTE_RE = /^<quote>([^<]*)<\/quote>\s*(?:<note>([^<]*)<\/note>\s*)?$/
const QA_RE = /^(?:<question>([^<]*)<\/question>\s*)?<answer>([^<]*)<\/answer>\s*$/

/**
 * Only legacy messages contain unescaped Chinese question/answer tags.
 * v4 fields are decoded individually, so literal XML in an answer stays text.
 */
export function flattenReflowContent(content: string): string {
  return content
    .replace(/<问>([\s\S]*?)<\/问>/g, '$1')
    .replace(/<答>([\s\S]*?)<\/答>/g, '$1')
}

/** 跳过空白（含换行），返回新位置。 */
function skipBlank(text: string, pos: number): number {
  while (pos < text.length && /\s/.test(text[pos]!)) pos += 1
  return pos
}

/** Parse only our emitted grammar; malformed/unknown versions stay visible as ordinary text. */
function splitV4Prefix(text: string): ProtocolPrefix | null {
  const header = /^<sidenote-context version="4">\s*<guidance>[^<]*<\/guidance>\s*/.exec(text)
  if (!header) return null
  let pos = header[0].length
  const annotations: ParsedAnnotation[] = [], reflows: ParsedRefFlow[] = [], documents: DocumentQuote[] = []
  const seen = new Set<string>()
  for (;;) {
    REFERENCE_RE.lastIndex = pos
    const match = REFERENCE_RE.exec(text)
    if (!match) break
    const [, type, number, encodedSource, start, end, content] = match
    const id = Number(number), source = decodeXml(encodedSource!)
    const key = `${type}:${id}`
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(key)) return null
    seen.add(key)
    if (type === 'document') {
      const fields = QUOTE_RE.exec(content!)
      const document = readDocumentLocation({ path: source, ...(start === undefined ? {} : { pageStart: Number(start), pageEnd: Number(end) }) })
      if (!fields || fields[2] !== undefined || !document) return null
      documents.push({ id, quote: decodeXml(fields[1]!), document })
    } else {
      if (start !== undefined || (source !== 'main-chat' && source !== 'side-chat')) return null
      if (type === 'annotation') {
        const fields = QUOTE_RE.exec(content!)
        if (!fields) return null
        annotations.push({ id, quote: decodeXml(fields[1]!), note: decodeXml(fields[2] ?? '') })
      } else {
        const fields = QA_RE.exec(content!)
        if (!fields || source !== 'side-chat') return null
        reflows.push({ source, content: fields.slice(1).filter(field => field !== undefined).map(decodeXml).join('\n') })
      }
    }
    pos = skipBlank(text, REFERENCE_RE.lastIndex)
  }
  const close = '</sidenote-context>'
  if (!seen.size || !text.startsWith(close, pos)) return null
  const end = pos + close.length
  // Consume only the sender's separator, preserving indentation and blank lines in the body.
  const separator = /^\r?\n\r?\n/.exec(text.slice(end))?.[0].length ?? 0
  return { length: end + separator, annotations, reflows, ...(documents.length ? { documents } : {}) }
}

/**
 * Read v4 or legacy prefixes without migrating stored messages. Legacy payloads
 * remain verbatim; only attributes/document text that were escaped are decoded.
 */
export function splitProtocolPrefix(text: string): ProtocolPrefix | null {
  if (text.startsWith('<sidenote-context')) return splitV4Prefix(text)
  let pos = 0
  const reflows: ParsedRefFlow[] = []
  const annotations: ParsedAnnotation[] = []
  const documents: DocumentQuote[] = []

  // 1) 连续的回流块（send.ts 组装序：回流在前）。
  for (;;) {
    REFLOW_RE.lastIndex = pos
    const m = REFLOW_RE.exec(text)
    if (m === null) break
    reflows.push({ source: decodeXml(m[1] ?? ''), content: flattenReflowContent((m[3] ?? '').trim()) })
    pos = skipBlank(text, REFLOW_RE.lastIndex)
  }

  // An old open client can inject a reflow beside a new client's v4 user message.
  const current = reflows.length ? splitV4Prefix(text.slice(pos)) : null
  if (current) return { ...current, length: pos + current.length, reflows: [...reflows, ...current.reflows] }

  for (;;) {
    const parsed = parseLegacyDocumentQuote(text, pos)
    if (!parsed) break
    documents.push(parsed.quote)
    pos = skipBlank(text, parsed.end)
  }

  // 注释块：头部行 + 连续 <annotation> 块。
  const rest = text.slice(pos)
  const headerMatch = /^([^\n]*)\n/.exec(rest)
  if (headerMatch !== null && PROTOCOL_HEADER_RE.test(headerMatch[1] ?? '')) {
    let cursor = pos + headerMatch[0].length
    // Read-only compatibility for early preview messages.
    const legacyGuidance = /^Annotation ids stay stable within (?:their session scope|this conversation)\.[^\n]*\n/.exec(text.slice(cursor))
    if (legacyGuidance) cursor += legacyGuidance[0].length
    for (;;) {
      ANNOTATION_RE.lastIndex = cursor
      const m = ANNOTATION_RE.exec(text)
      if (m === null) break
      // 旧预览消息有 local 属性时，沿用当时显示的编号。
      annotations.push({ id: Number(m[2] ?? m[1]), quote: m[3] ?? '', note: (m[4] ?? '').trim() })
      cursor = skipBlank(text, ANNOTATION_RE.lastIndex)
    }
    if (annotations.length > 0) {
      pos = cursor
    } else if (reflows.length === 0 && documents.length === 0) {
      return null
    }
    // 有回流但头部行后无注释块：头部行属用户巧合文本，不消费（留给正文）。
  } else if (reflows.length === 0 && documents.length === 0) {
    return null
  }

  if (reflows.length === 0 && annotations.length === 0 && documents.length === 0) return null
  // 协议区与正文之间的一个空行分隔也一并消费。
  const end = skipBlank(text, pos)
  return { length: end, annotations, reflows, ...(documents.length ? { documents } : {}) }
}

export { splitSnapshotPrefix } from '../../snapshotProtocol.ts'
