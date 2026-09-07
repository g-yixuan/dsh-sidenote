/**
 * 会话快照 → 消息视图模型（L0 纯逻辑，node 可测）。
 *
 * WI-01 起这里是消息渲染管线的唯一入口（自 sidechat/model.ts 迁入——
 * legacy 快照字段（nodes/partial/runningCalls，官方已标 Legacy）的消费
 * 单点化：0.1.2 迁移到 ChatSnapshot 新面时只动本文件）。
 *
 * 数据源事实（权威注释）：ConversationSnapshot.nodes 是 ConversationNode
 * 联合（kind 判别，seq 稳定——「seq is the React key」），partial/
 * runningCalls 承载在途流式输出。
 */
import type { ConversationSnapshot } from '../host/contracts.ts'
import { t } from '../locales.ts'

/** 面板渲染用的消息视图（自绘；工具卡片等复杂节点降级为简洁块）。 */
export interface ChatMessage {
  /** React key（节点 seq / 在途 callId 派生，稳定）。 */
  key: string
  role: 'user' | 'assistant' | 'tool' | 'notice' | 'error'
  /** markdown 正文（assistant）或纯文本（其他）。 */
  text: string
  /** assistant 的思考内容（折叠渲染）；缺省 = 无。 */
  reasoning?: string
  /** tool 角色的工具名。 */
  toolName?: string
  /** tool 角色的失败标记。 */
  isError?: boolean
  /** 流式中（partial / runningCalls）。 */
  streaming?: boolean
  /** 被打断冻结的 assistant 输出（渲染「已停止」标记）。 */
  interrupted?: boolean
}

/** 工具结果正文截断上限（面板是窄栏，超长输出不撑爆 DOM）。 */
export const TOOL_TEXT_LIMIT = 4000

export function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

interface LooseBlock {
  type?: unknown
  kind?: unknown
  text?: unknown
  name?: unknown
}

/** ContentBlock[] → 纯文本：text 块拼接；image 块降级占位；其余忽略。 */
export function contentTextOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as LooseBlock
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'image') parts.push(t('imagePlaceholder'))
  }
  return parts.join('\n')
}

function seqKey(prefix: string, node: Record<string, unknown>): string {
  return `${prefix}:${typeof node.seq === 'number' ? node.seq : '?'}`
}

function assistantParts(blocks: unknown): { text: string; reasoning: string; hasToolCall: boolean } {
  const texts: string[] = []
  const reasonings: string[] = []
  let hasToolCall = false
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as LooseBlock
      if (b.kind === 'text' && typeof b.text === 'string') texts.push(b.text)
      else if (b.kind === 'reasoning' && typeof b.text === 'string') reasonings.push(b.text)
      else if (b.kind === 'tool-call') hasToolCall = true
    }
  }
  return { text: texts.join('\n\n'), reasoning: reasonings.join('\n\n'), hasToolCall }
}

/**
 * 单个 ConversationNode → ChatMessage；返回 null = 面板不渲染
 * （context 注入、未知面事件、已取消的重试等对读者无信息的节点）。
 */
export function nodeToMessage(node: unknown): ChatMessage | null {
  if (typeof node !== 'object' || node === null) return null
  const n = node as Record<string, unknown>
  switch (n.kind) {
    case 'user':
      return { key: seqKey('u', n), role: 'user', text: contentTextOf(n.content) }
    case 'steering':
      return { key: seqKey('s', n), role: 'user', text: contentTextOf(n.content) }
    case 'assistant': {
      const { text, reasoning, hasToolCall } = assistantParts(n.blocks)
      // 纯工具调用头的 assistant 节点不渲染（tool-result 节点承载工具卡片）。
      if (text === '' && reasoning === '' && hasToolCall) return null
      return {
        key: seqKey('a', n),
        role: 'assistant',
        text,
        ...(reasoning !== '' ? { reasoning } : {}),
        ...(n.interrupted === true ? { interrupted: true } : {}),
      }
    }
    case 'tool-result': {
      const call = n.call as { name?: unknown } | null
      const toolName = typeof call?.name === 'string'
        ? call.name
        : typeof n.callId === 'string' ? n.callId : t('toolFallback')
      return {
        key: seqKey('t', n),
        role: 'tool',
        toolName,
        text: truncateText(contentTextOf(n.content), TOOL_TEXT_LIMIT),
        ...(n.isError === true ? { isError: true } : {}),
      }
    }
    case 'turn-error':
      return { key: seqKey('e', n), role: 'error', text: typeof n.message === 'string' ? n.message : t('unknownError') }
    case 'model-retry': {
      if (n.retryState === 'cancelled') return null
      return {
        key: seqKey('r', n),
        role: 'notice',
        text: t(n.retryState === 'started' ? 'modelRetryStarted' : 'modelRetryWaiting'),
      }
    }
    case 'turn-max-tokens':
      return { key: seqKey('m', n), role: 'notice', text: t('maxTokens') }
    case 'command': {
      const name = typeof n.name === 'string' && n.name !== '' ? n.name : t('commandNameFallback')
      // args 数据源自带前导空格（「/goal x」形态），trimStart 后统一补一个空格，
      // 防止「/sidefoo」（缺分隔）或「/goal  x」（双空格）。
      const args = typeof n.args === 'string' ? n.args.trimStart() : ''
      return { key: seqKey('c', n), role: 'notice', text: t('runCommand', { cmd: `/${name}${args === '' ? '' : ` ${args}`}` }) }
    }
    case 'compaction':
      return { key: seqKey('k', n), role: 'notice', text: t('compacted') }
    default:
      // context（注入）/ unknown（未识面事件）：MVP 不渲染。
      return null
  }
}

/**
 * ConversationSnapshot → 渲染消息列表：终态节点 + 在途项（按 turn/step 归并）。
 * 快照缺省（未绑定）时为空列表。
 *
 * 时序归并（WI-01）：在途项不再恒追加尾部——真实交错是「partial 文本 → 它
 * 自己 step 发出的工具卡」：partial 与同 step 的 runningCall 并存时必须文本
 * 在前（原文早于调用），不同 step 按 (turn, step) 升序；并行多 call 保持
 * 宿主 dispatch 序（同 turn/step 内稳定）。终态节点自带 seq 全序，不参与
 * 归并（在途项永远属于当前 turn 的前沿，尾部插入点天然正确）。
 */
export function transcriptOf(snapshot: ConversationSnapshot | undefined | null): ChatMessage[] {
  if (snapshot === undefined || snapshot === null) return []
  const out: ChatMessage[] = []
  for (const node of snapshot.nodes ?? []) {
    const message = nodeToMessage(node)
    if (message !== null) out.push(message)
  }

  // ── 在途项收集（带 turn/step 排序键）──
  interface InFlight {
    turn: number
    step: number
    /** 同 (turn,step) 时 partial 先于 tool（文本先于它发出的调用）。 */
    order: 0 | 1
    message: ChatMessage
  }
  const inflight: InFlight[] = []

  // 流式中的 assistant 部分输出（partial 缺 turn/step 时按最新处理——排在在途尾）。
  const partial = snapshot.partial as { blocks?: unknown; turn?: unknown; step?: unknown } | null | undefined
  if (partial !== undefined && partial !== null) {
    const { text, reasoning, hasToolCall } = assistantParts(partial.blocks)
    if (text !== '' || reasoning !== '' || !hasToolCall) {
      inflight.push({
        turn: typeof partial.turn === 'number' ? partial.turn : Number.MAX_SAFE_INTEGER,
        step: typeof partial.step === 'number' ? partial.step : Number.MAX_SAFE_INTEGER,
        order: 0,
        message: {
          key: 'partial',
          role: 'assistant',
          text,
          ...(reasoning !== '' ? { reasoning } : {}),
          streaming: true,
        },
      })
    }
  }

  // 在途工具调用（tool/call 已见、tool/result 未至）。
  if (Array.isArray(snapshot.runningCalls)) {
    for (const call of snapshot.runningCalls) {
      if (typeof call !== 'object' || call === null) continue
      const c = call as { callId?: unknown; name?: unknown; turn?: unknown; step?: unknown }
      inflight.push({
        turn: typeof c.turn === 'number' ? c.turn : Number.MAX_SAFE_INTEGER,
        step: typeof c.step === 'number' ? c.step : Number.MAX_SAFE_INTEGER,
        order: 1,
        message: {
          key: `rc:${typeof c.callId === 'string' ? c.callId : '?'}`,
          role: 'tool',
          toolName: typeof c.name === 'string' ? c.name : t('toolFallback'),
          text: '',
          streaming: true,
        },
      })
    }
  }

  // 稳定排序（同键保持收集序 = 宿主 dispatch 序）。
  inflight.sort((a, b) => a.turn - b.turn || a.step - b.step || a.order - b.order)
  for (const item of inflight) out.push(item.message)
  return out
}
