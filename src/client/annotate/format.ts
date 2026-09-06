import { t } from '../locales.ts'

/**
 * Wire format v2 (Workitem 01 of Delivery_02 — 注释架构受控化) — the shapes here
 * ARE the contract for 「发送给模型的数据形态」与「气泡反解析协议」:
 *
 *   我批注了以下 2 处内容：
 *   1. 「引用原文（单行折叠、500 字截断）」注解：xxx
 *   2. 「引用原文」（无注解）
 *
 *   用户消息正文
 *
 * 设计约束：
 * - 每条注释一行（markdown 有序列表项）——气泡手术因此能确定性地定位
 *   「头部 <p> + 紧随的 <ol>」，不用猜结构（列表编号是 CSS ::marker，不进
 *   textContent，条目正文以「」起始天然可解析）。
 * - 头部句/注解词双语成对（发送时的 locale 决定写入语言；反解析双语都认，
 *   因为发出后用户可能切换界面语言）。
 * - 模型面最小提示：不注入「请逐条回应」格式指令（编号 1./2. 已足够模型
 *   引用；dsh-annotation 的指令式协议是更重选择，暂不取）。
 */

/** Selected-text bound admitted into one annotation (超长截断 + 标记). */
export const SELECTION_LIMIT = 500

/** Marker appended when a selection is truncated (参照 sidebar-qa 的省略号模式). */
export const TRUNCATION_MARK = '…'

/** Bound a quote to {@link SELECTION_LIMIT} characters, marking truncation. */
export function truncateQuote(text: string, limit: number = SELECTION_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}${TRUNCATION_MARK}`
}

/** 引用折叠为单行：换行用 ⏎ 可视占位（模型可读、单行列表项可解析）。 */
export function flattenQuote(text: string): string {
  return text.replace(/\r?\n/g, '⏎')
}

export interface QuoteItem {
  readonly text: string
  readonly note: string
}

/** 协议头（双语）：zh「我批注了以下 2 处内容：」/ en 见 locales。 */
export function protocolHeader(n: number): string {
  return t('protocolHeader', { n })
}

/** One annotation's protocol line: `1. 「quote」注解：note`. */
export function formatProtocolLine(index: number, item: QuoteItem): string {
  const quote = flattenQuote(truncateQuote(item.text))
  const note = item.note.trim() === '' ? t('noNote') : t('noteLine', { note: item.note })
  return `${index}. 「${quote}」${note}`
}

/**
 * The full protocol block: header + one ordered-list line per annotation.
 * 与正文之间空一行（markdown 列表与后续段落的自然分隔）。
 */
export function buildProtocolBlock(items: readonly QuoteItem[]): string {
  return [
    protocolHeader(items.length),
    ...items.map((item, i) => formatProtocolLine(i + 1, item)),
  ].join('\n')
}

/** 「在侧边聊天中提问」的种子引用（进侧边草稿，不是协议块——保持轻量）。 */
export function buildSideChatQuote(text: string, note = ''): string {
  const quote = text.split('\n').map(line => (line === '' ? '>' : `> ${line}`)).join('\n')
  const noteLine = note.trim() === '' ? t('noNote') : t('noteLine', { note })
  return `${quote}\n${noteLine}`
}

// ── 反解析（气泡手术用；双语容错） ────────────────────────────────────────────

/** 协议头识别（zh/en 都认）：只匹配「整行就是头部」的形态。 */
export const PROTOCOL_HEADER_RE = /^(?:我批注了以下 (\d+) 处内容：|I annotated (\d+) passage\(s\) of the conversation above:)$/

/** 单条目识别（li 的 textContent，不含列表编号）：「quote」注解：note / （无注解）。 */
const PROTOCOL_ITEM_RE = /^「([\s\S]*?)」(.*?)$/

export interface ParsedProtocolItem {
  readonly quote: string
  /** '' = 无注解。 */
  readonly note: string
}

/** 解析单条 li 文本；note 词按双语剥离。 */
export function parseProtocolItem(text: string): ParsedProtocolItem | null {
  const m = PROTOCOL_ITEM_RE.exec(text.trim())
  if (m === null) return null
  const quote = m[1] ?? ''
  const tail = (m[2] ?? '').trim()
  let note = ''
  for (const prefix of ['注解：', 'Note:']) {
    if (tail.startsWith(prefix)) {
      note = tail.slice(prefix.length).trim()
      break
    }
  }
  if (note === '' && tail !== '' && tail !== '（无注解）' && tail !== '(no note)') return null
  return { quote, note }
}
