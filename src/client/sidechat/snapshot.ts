/** Mainline progress after the actual fork cut. Chat retains an audit trail;
 * committed compaction replacements determine the effective context instead. */
import type { Context, ConversationSnapshot } from '../host/contracts.ts'
import { chatSourceOf, contextEventSource, loadInheritedContext, retainSession, type ContextEvent, type ContextEventWindow } from '../host/chat.ts'

/** 快照里的一拍（当前 turn 的一段内容）。 */
export interface SnapshotEntry {
  kind: 'checkpoint' | 'request' | 'reply' | 'thinking' | 'tool' | 'streaming'
  text: string
  /** tool 拍携带工具名。 */
  toolName?: string
}

/** Read the plugin's persisted progress block as plain, expandable content. */
export function snapshotEntriesFromText(text: string): SnapshotEntry[] {
  const kinds = { checkpoint: 'checkpoint', 'user-request': 'request', reply: 'reply', thinking: 'thinking', 'tool-call': 'tool', streaming: 'streaming' } as const
  return [...text.matchAll(/<(checkpoint|user-request|reply|thinking|tool-call|streaming)(?: name="([^"]*)")?>([\s\S]*?)<\/\1>/g)]
    .map(match => ({ kind: kinds[match[1] as keyof typeof kinds], text: match[3]!.trim(), ...(match[2] ? { toolName: match[2] } : {}) }))
}

interface LooseBlock { type?: unknown; kind?: unknown; text?: unknown }

function blocksText(blocks: unknown, kinds: readonly string[]): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as LooseBlock
    const kind = (b.kind ?? b.type) as string | undefined
    if (kind !== undefined && kinds.includes(kind) && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

function contentText(content: unknown): string {
  return blocksText(content, ['text'])
}

/** Chat is an audit transcript, not the model surface. A committed checkpoint
 * replaces explicit surface identities; its retained tail can have LOWER seqs
 * than the checkpoint itself. Never truncate that tail by timestamp or max seq. */
export function effectiveContextNodes(nodes: readonly unknown[], window: ContextEventWindow | undefined, throughSeq = Infinity): { nodes: readonly unknown[]; checkpointSeq?: number } {
  const events = window?.entries.map(entry => entry.event).filter(event => event.seq <= throughSeq) ?? []
  const checkpoint = events.findLast(event => event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint' && event.surfaceOp !== undefined && event.surfaceOp !== 'append')
  const eligible = nodes.filter(node => (node as { seq: number }).seq <= throughSeq)
  const shadowed = new Set<number>()
  const pruned = new Map<number, ContextEvent>()
  for (let i = 0; i < events.length - 1; i++) {
    const event = events[i]!, next = events[i + 1]!
    // A summary without its committed replacement (failed/in-flight compaction)
    // cannot hide history. This adjacency is the host's shadow-price contract.
    if (['compaction/summary', 'compaction/prune'].includes(event.type) && next.surfaceOp && next.surfaceOp !== 'append') {
      for (const seq of event.data.shadowedSeqs ?? []) shadowed.add(seq)
      if (event.type === 'compaction/prune' && next.type === 'tool/result' && next.data.message) {
        for (const seq of event.data.shadowedSeqs ?? []) pruned.set(seq, next)
      }
    }
  }
  // Chat keeps the original tool/result for auditing and ignores replacement
  // events. Replay just those committed replacements before removing shadows;
  // otherwise a retained, pruned tool result either leaks its old body or vanishes.
  const tail = eligible.map(node => {
    let current = node as { seq: number; kind: string; content?: unknown }
    if (current.kind !== 'tool-result') return current
    for (let replacement = pruned.get(current.seq); replacement; replacement = pruned.get(current.seq)) {
      current = { ...current, seq: replacement.seq, content: replacement.data.message!.content }
    }
    return current
  }).filter(node => {
    const n = node as { seq: number; kind: string }
    return !shadowed.has(n.seq) && n.kind !== 'compaction' && n.seq !== checkpoint?.seq
  })
  if (!checkpoint) return { nodes: tail }
  const summary = events.find(event => event.seq === checkpoint.seq - 1 && event.type === 'compaction/summary')
  const content = summary?.data.summary ?? checkpoint.data.content ?? []
  return { nodes: [{ kind: 'checkpoint', seq: checkpoint.seq, content }, ...tail], checkpointSeq: checkpoint.seq }
}

/** Effective context → readable snapshot entries. A new checkpoint carries its
 * surviving tail; otherwise only nodes after the child's inherited cut are added. */
export function snapshotEntriesOf(nodes: readonly unknown[], partial?: unknown, boundarySeq?: number, runningCalls: readonly unknown[] = []): SnapshotEntry[] {
  let start = -1
  const checkpoint = nodes.findIndex(node => (node as { kind: string }).kind === 'checkpoint' && (node as { seq: number }).seq > (boundarySeq ?? -1))
  if (checkpoint >= 0) start = checkpoint
  else if (boundarySeq !== undefined) { nodes = nodes.filter(node => (node as { seq: number }).seq > boundarySeq); start = 0 }
  else for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i] as Record<string, unknown>
    if (n?.kind === 'user' || n?.kind === 'steering') { start = i; break }
  }
  const entries: SnapshotEntry[] = []
  for (const node of start < 0 ? [] : nodes.slice(start)) {
    const n = node as Record<string, unknown>
    switch (n.kind) {
      case 'checkpoint': {
        const text = contentText(n.content)
        if (text) entries.push({ kind: 'checkpoint', text })
        break
      }
      case 'user':
      case 'steering': {
        const text = contentText(n.content)
        if (text !== '') entries.push({ kind: 'request', text })
        break
      }
      case 'assistant': {
        const thinking = blocksText(n.blocks, ['reasoning'])
        const reply = blocksText(n.blocks, ['text'])
        if (thinking !== '') entries.push({ kind: 'thinking', text: thinking })
        if (reply !== '') entries.push({ kind: 'reply', text: reply })
        break
      }
      case 'tool-result': {
        const call = n.call as { name?: unknown; argsRaw?: unknown } | null
        const name = typeof call?.name === 'string' ? call.name : 'tool'
        const args = typeof call?.argsRaw === 'string' ? call.argsRaw : ''
        const result = contentText(n.content)
        entries.push({
          kind: 'tool',
          toolName: name,
          text: args === '' ? result : `调用：${args}\n${result}`,
        })
        break
      }
      default:
        break
    }
  }
  // 在途流式输出（正在生成的 assistant 正文）——投影的 partial 面。
  const thinking = blocksText((partial as { blocks?: unknown })?.blocks, ['reasoning'])
  if (thinking) entries.push({ kind: 'thinking', text: thinking })
  const streaming = typeof partial === 'string'
    ? partial
    : contentText((partial as { blocks?: unknown })?.blocks)
  if (streaming !== '') entries.push({ kind: 'streaming', text: streaming })
  for (const value of runningCalls) {
    const call = value as { name?: string; argsRaw?: string }
    if (call.name) entries.push({ kind: 'tool', toolName: call.name, text: `调用：${call.argsRaw ?? ''}\n（执行中）` })
  }
  return entries
}

/** 拍序列 → 协议块文本（拼进首条侧边消息前缀的形态）。 */
export function serializeSnapshot(entries: readonly SnapshotEntry[], takenAt: Date): string {
  const pad = (v: number): string => String(v).padStart(2, '0')
  const stamp = `${takenAt.getFullYear()}-${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())} ${pad(takenAt.getHours())}:${pad(takenAt.getMinutes())}`
  const body = entries.map((entry) => {
    switch (entry.kind) {
      case 'checkpoint': return `<checkpoint>\n${entry.text}\n</checkpoint>`
      case 'request': return `<user-request>\n${entry.text}\n</user-request>`
      case 'reply': return `<reply>\n${entry.text}\n</reply>`
      case 'thinking': return `<thinking>\n${entry.text}\n</thinking>`
      case 'tool': return `<tool-call name="${entry.toolName ?? 'tool'}">\n${entry.text}\n</tool-call>`
      case 'streaming': return `<streaming>\n${entry.text}\n（主线正在输出中）</streaming>`
    }
  }).join('\n\n')
  return `<mainline-progress-snapshot taken-at="${stamp}">
你是从主线会话 fork 出的侧边会话。以下是截至首次发送时的主线进展。若包含 checkpoint，它是最新压缩摘要，并与后续条目一起替代此前的主线上下文；否则这些条目补充在继承历史之后。主线独立运行，请将这些内容作为上下文，不要替主线重复执行任务：

${body}
</mainline-progress-snapshot>`
}

/** 协议块标记（WI-03 呈现层据此把快照从气泡提升到继承卡）。 */
export const SNAPSHOT_BLOCK_MARK = '<mainline-progress-snapshot'

/**
 * 现取主线进展；即使当前没有文字进展也记录发送时间并消费首次快照。
 * 只有主线投影尚不可读时返回 null。
 */
export function buildMainlineSnapshot(ctx: Context, parentSessionId: string, now: Date = new Date(), boundarySeq?: number): string | null {
  try {
    const binding = ctx.sessions.binding(parentSessionId)
    const source = chatSourceOf(ctx, binding)
    const snap = source?.getLegacy() as (ConversationSnapshot & { partial?: unknown }) | null
    if (snap === undefined || snap === null) return null
    const effective = effectiveContextNodes(snap.nodes ?? [], contextEventSource(binding?.session)?.getSnapshot())
    const entries = snapshotEntriesOf(effective.nodes, snap.partial, boundarySeq, snap.runningCalls)
    return serializeSnapshot(entries, now)
  } catch {
    return null
  }
}

/** A cold parent may expose only its tail page. Do not permanently freeze that
 * partial view into the first side prompt. A newer checkpoint needs its full
 * retained surface (which can contain older seqs); replay it from shared history. */
export async function loadMainlineSnapshot(ctx: Context, parentSessionId: string, boundarySeq: number): Promise<string> {
  const retained = retainSession(ctx, parentSessionId)
  try {
    const binding = retained ? await retained.ready : ctx.sessions.binding(parentSessionId)
    await loadInheritedContext(binding?.session, boundarySeq)
    if (contextEventSource(binding?.session)?.getSnapshot().entries.some(({ event }) => event.seq > boundarySeq && event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint')) {
      await loadInheritedContext(binding?.session, 0)
    }
    const text = buildMainlineSnapshot(ctx, parentSessionId, new Date(), boundarySeq)
    if (text === null) throw new Error('主线上下文尚未就绪，内容已保留，请重新发送')
    return text
  } finally { retained?.release() }
}

export { splitSnapshotPrefix } from '../annotations/format.ts'
