import { t } from '../locales.ts'

/**
 * Quote-block formatting and the managed-draft math (Workitem 02). Pure and
 * dependency-free for unit testing — the shapes here ARE the contract for
 * 「发送给模型的数据形态」:
 *
 *   > 原文片段 1
 *   注解：xxx
 *
 *   > 原文片段 2
 *   （无注解）
 *
 *   用户消息正文
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

/** Quote one (possibly multi-line) text as `> `-prefixed lines. */
export function quoteLines(text: string): string {
  return text.split('\n').map(line => (line === '' ? '>' : `> ${line}`)).join('\n')
}

export interface QuoteItem {
  readonly text: string
  readonly note: string
}

/** One annotation's block: quoted original plus the note line. */
export function formatQuoteItem(item: QuoteItem): string {
  const noteLine = item.note.trim() === '' ? t('noNote') : t('noteLine', { note: item.note })
  return `${quoteLines(item.text)}\n${noteLine}`
}

/** The full context block for every active annotation, in creation order. */
export function buildQuoteBlock(items: readonly QuoteItem[]): string {
  return items.map(formatQuoteItem).join('\n\n')
}

/** The 「在侧边聊天中提问」 seed: quote + optional note（与主对话注释同构）. */
export function buildSideChatQuote(text: string, note = ''): string {
  return formatQuoteItem({ text, note })
}

/**
 * Recompute a session composer draft from its managed head.
 *
 * The managed head (quote block + one blank line) is maintained at the very
 * top of the draft while annotations are active; the user's own text follows
 * it untouched. `lastHead` is the head we last wrote: when the draft still
 * starts with it we strip exactly that span; otherwise the user meddled with
 * the head region and the whole draft is treated as user text (the fresh head
 * is simply re-prepended — a documented, non-crashing degradation).
 */
export function nextManagedDraft(
  draft: string,
  lastHead: string,
  block: string,
): { head: string; draft: string } {
  const userText = lastHead !== '' && draft.startsWith(lastHead) ? draft.slice(lastHead.length) : draft
  const head = block === '' ? '' : `${block}\n\n`
  return { head, draft: head + userText }
}

/**
 * The send-edge predicate: the composer draft flipping non-empty → empty
 * while annotations were attached is the reliable「发送后」signal (submit
 * clears the draft as a commit; queueing does too). Whitespace-only drafts
 * count as empty.
 */
export function isSendEdge(previousDraft: string, nextDraft: string): boolean {
  return previousDraft.trim() !== '' && nextDraft.trim() === ''
}
