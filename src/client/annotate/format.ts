import { t } from '../locales.ts'

/**
 * Wire format v3（2026-09-06 用户裁定）——发送给模型的数据形态与气泡
 * 反解析协议的唯一权威：
 *
 *   我批注了以下 2 处内容：
 *   <annotation id="1">
 *   <quote>引用原文（原样、可多行、不截断）</quote>
 *   <note>用户注解</note>
 *   </annotation>
 *   <annotation id="2">
 *   <quote>引用原文 2</quote>
 *   </annotation>
 *
 *   用户消息正文
 *
 * 为什么是 XML 块（替代 v2 的「」单行列表）：
 * - 嵌套消歧：「」在引用内容自身含「」时边界模糊（用户实测踩中）；XML 标签
 *   语义严谨、模型可读性是业界共识（Claude 官方推荐、Codex additionalContext
 *   用 <external_KEY> 同款）。
 * - 无注解的注释省略 <note>（而不是「（无注解）」占位噪音）。
 * - 气泡侧：宿主 user 气泡是纯文本渲染（UserStyleBubble/projectUserText，
 *   无 markdown 元素），隐藏手术按字符区间切文本节点完成，因此协议区必须
 *   是消息的**连续前缀**（send.ts 保证组装顺序）。
 *
 * 截断纪律（用户裁定 2026-09-06）：引用/回流内容一律全文，不截断——
 * 静默截断会让用户不知道内容少了（「产生幻觉」）。quote 是用户亲手划选的，
 * chip 预览用 CSS 省略即可，wire 上永远全文。
 */

export interface QuoteItem {
  readonly text: string
  readonly note: string
  /** 展示编号（与角标一致），作为 <annotation id> 供模型引用。 */
  readonly number?: number
}

/** 协议头（双语）：zh「我批注了以下 2 处内容：」/ en 见 locales。 */
export function protocolHeader(n: number): string {
  return t('protocolHeader', { n })
}

/** One annotation's XML block（无注解时省略 <note>）。 */
export function formatAnnotationXml(index: number, item: QuoteItem): string {
  const id = item.number ?? index
  const note = item.note.trim()
  return note === ''
    ? `<annotation id="${id}">\n<quote>${item.text}</quote>\n</annotation>`
    : `<annotation id="${id}">\n<quote>${item.text}</quote>\n<note>${note}</note>\n</annotation>`
}

/** 注释协议块 = 头部句 + 每个注释一个 XML 块（行间无空行，与正文空一行）。 */
export function buildProtocolBlock(items: readonly QuoteItem[]): string {
  return [
    protocolHeader(items.length),
    ...items.map((item, i) => formatAnnotationXml(i + 1, item)),
  ].join('\n')
}

/** 「在侧边聊天中提问」的种子引用（进侧边草稿，不是协议块——保持轻量）。 */
export function buildSideChatQuote(text: string, note = ''): string {
  const quote = text.split('\n').map(line => (line === '' ? '>' : `> ${line}`)).join('\n')
  const noteLine = note.trim() === '' ? t('noNote') : t('noteLine', { note })
  return `${quote}\n${noteLine}`
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
  /** 协议区在消息文本中的字符长度（前缀，手术按它切）。 */
  readonly length: number
  readonly annotations: readonly ParsedAnnotation[]
  readonly reflows: readonly ParsedRefFlow[]
}

const ANNOTATION_RE = /<annotation id="(\d+)">\s*<quote>([\s\S]*?)<\/quote>\s*(?:<note>([\s\S]*?)<\/note>\s*)?<\/annotation>/y
const REFLOW_RE = /<reflow\s+source="([^"]*)"(?:\s+reason="([^"]*)")?\s*>([\s\S]*?)<\/reflow>/y

/**
 * 气泡 tooltip / 面板留痕 chip 的展示拍平：剥掉 <问>/<答> 协议标签只留内容行
 * （协议标签是 wire 形态，不出现在 UI）。仅用于 title 悬浮文案。
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

/**
 * 从消息文本开头解析协议前缀（回流块* → 注释块）：任一命中即返回。
 * 全部不命中返回 null（普通用户消息，零开销）。
 * 注意：内容里恰好含字面 `</quote>` 会在该处截断解析（已知极限，聊天引用
 * 场景可忽略；Codex 的 <external_KEY> 同款取舍）。
 */
export function splitProtocolPrefix(text: string): ProtocolPrefix | null {
  let pos = 0
  const reflows: ParsedRefFlow[] = []
  const annotations: ParsedAnnotation[] = []

  // 1) 连续的回流块（send.ts 组装序：回流在前）。
  for (;;) {
    REFLOW_RE.lastIndex = pos
    const m = REFLOW_RE.exec(text)
    if (m === null) break
    reflows.push({ source: m[1] ?? '', content: (m[3] ?? '').trim() })
    pos = skipBlank(text, REFLOW_RE.lastIndex)
  }

  // 2) 注释块：头部行 + 连续 <annotation> 块。
  const rest = text.slice(pos)
  const headerMatch = /^([^\n]*)\n/.exec(rest)
  if (headerMatch !== null && PROTOCOL_HEADER_RE.test(headerMatch[1] ?? '')) {
    let cursor = pos + headerMatch[0].length
    for (;;) {
      ANNOTATION_RE.lastIndex = cursor
      const m = ANNOTATION_RE.exec(text)
      if (m === null) break
      annotations.push({ id: Number(m[1]), quote: m[2] ?? '', note: (m[3] ?? '').trim() })
      cursor = skipBlank(text, ANNOTATION_RE.lastIndex)
    }
    if (annotations.length > 0) {
      pos = cursor
    } else if (reflows.length === 0) {
      return null
    }
    // 有回流但头部行后无注释块：头部行属用户巧合文本，不消费（留给正文）。
  } else if (reflows.length === 0) {
    return null
  }

  if (reflows.length === 0 && annotations.length === 0) return null
  // 协议区与正文之间的一个空行分隔也一并消费。
  const end = skipBlank(text, pos)
  return { length: end, annotations, reflows }
}
