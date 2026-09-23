/**
 * 主线进展快照构建器（Delivery_04 / WI-02，L0 纯逻辑 + L3 读取编排）。
 *
 * 背景：busy fork 的子会话只继承到「最后一个已完成 turn」——主线在飞 turn
 * 的内容（任务、思考、工具进展）不在继承历史里。本模块在侧边首条消息发送
 * 时把这部分内容现取（不是 fork 时刻——主线还在跑，发送时才最新）序列化为
 * 协议块，拼进首条侧边消息前缀。
 *
 * 读取面：chatSourceOf 的 legacy 投影——它是**模型可见投影**：压缩过的范围
 * 投影为摘要节点、被修剪的工具结果已移除。即「最后一个压缩点之后的内容」
 * 语义由投影天然实现，尺寸天然有界（= 主线模型此刻实际所见，主线装得下
 * 我们就装得下；超窗由宿主对子会话的压缩引擎兜底——不另设安全阀）。
 *
 * 缓存对齐：快照追加在 fork 继承历史（与主线前缀逐字一致）之后，不破坏
 * 前缀缓存命中。
 */
import type { Context, ConversationSnapshot } from '../host/contracts.ts'
import { chatSourceOf } from './lifecycle.ts'

/** 快照里的一拍（当前 turn 的一段内容）。 */
export interface SnapshotEntry {
  kind: 'request' | 'reply' | 'thinking' | 'tool' | 'streaming'
  text: string
  /** tool 拍携带工具名。 */
  toolName?: string
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

/**
 * 投影 nodes → 当前 turn 的快照拍序列。纯函数（node 可测）。
 *
 * 当前 turn 起点 = 最后一个 user 节点（在飞 turn 的任务消息）。注意：压缩
 * 摘要在投影里也是 user 形态节点（<compacted-summary> 框定的替换消息）——
 * 若最后一个 user 节点是摘要，从它取起同样正确（摘要即主线模型此刻的上下文
 * 头部）。起点之后：assistant 拆思考/正文两拍，tool-result 成拍，其余节点
 * （context 注入、系统面）不入快照。
 */
export function snapshotEntriesOf(nodes: readonly unknown[], partial?: unknown): SnapshotEntry[] {
  let start = -1
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i] as Record<string, unknown>
    if (n?.kind === 'user' || n?.kind === 'steering') { start = i; break }
  }
  if (start < 0) return []
  const entries: SnapshotEntry[] = []
  for (const node of nodes.slice(start)) {
    const n = node as Record<string, unknown>
    switch (n.kind) {
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
  const streaming = typeof partial === 'string'
    ? partial
    : contentText((partial as { blocks?: unknown })?.blocks)
  if (streaming !== '') entries.push({ kind: 'streaming', text: streaming })
  return entries
}

/** 拍序列 → 协议块文本（拼进首条侧边消息前缀的形态）。 */
export function serializeSnapshot(entries: readonly SnapshotEntry[], takenAt: Date): string {
  const pad = (v: number): string => String(v).padStart(2, '0')
  const stamp = `${takenAt.getFullYear()}-${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())} ${pad(takenAt.getHours())}:${pad(takenAt.getMinutes())}`
  const body = entries.map((entry) => {
    switch (entry.kind) {
      case 'request': return `<user-request>\n${entry.text}\n</user-request>`
      case 'reply': return `<reply>\n${entry.text}\n</reply>`
      case 'thinking': return `<thinking>\n${entry.text}\n</thinking>`
      case 'tool': return `<tool-call name="${entry.toolName ?? 'tool'}">\n${entry.text}\n</tool-call>`
      case 'streaming': return `<streaming>\n${entry.text}\n（主线正在输出中）</streaming>`
    }
  }).join('\n\n')
  return `<mainline-progress-snapshot taken-at="${stamp}">
你是从主线会话 fork 出的侧边会话。主线有一个任务正在执行中——它在你 fork 时正在进行，所以以「已中断」形态出现在上面的历史末尾（那只是快照切点，主线本体仍在正常运行）。以下是主线该任务截至此刻的实时进展（与主线模型当前可见的上下文一致）：

${body}
</mainline-progress-snapshot>`
}

/** 协议块标记（WI-03 呈现层据此把快照从气泡提升到继承卡）。 */
export const SNAPSHOT_BLOCK_MARK = '<mainline-progress-snapshot'

/**
 * 现取主线当前 turn 的进展快照块。无任何在飞内容（主线恰在两轮之间等）
 * 返回 null（调用方跳过拼接）。
 */
export function buildMainlineSnapshot(ctx: Context, parentSessionId: string, now: Date = new Date()): string | null {
  try {
    const source = chatSourceOf(ctx, ctx.sessions.binding(parentSessionId))
    const snap = source?.getLegacy() as (ConversationSnapshot & { partial?: unknown }) | null
    if (snap === undefined || snap === null) return null
    const entries = snapshotEntriesOf(snap.nodes ?? [], snap.partial)
    if (entries.length === 0) return null
    return serializeSnapshot(entries, now)
  } catch {
    return null
  }
}
