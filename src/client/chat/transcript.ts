/** Business projection for reflow, topic and reference serialization.
 * The host Conversation owns all message and tool rendering. */
import type { ConversationSnapshot } from '../host/contracts.ts'
import { t } from '../locales.ts'

/** 问答和来源的轻量投影；不承担界面渲染。 */
export interface ChatMessage {
  /** React key（节点 seq / 在途 callId 派生，稳定）。 */
  key: string
  /** 源节点 seq（D1 折叠边界判定的依据；在途项无）。 */
  seq?: number
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

interface LooseBlock {
  type?: unknown
  kind?: unknown
  text?: unknown
  name?: unknown
}

/** Protocol readers need actual text, not attachment preview labels before it.
 * Native Conversation renders images; only an image-only message needs a label. */
export function contentTextOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  let hasImage = false
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as LooseBlock
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'image') hasImage = true
  }
  return parts.join('\n') || (hasImage ? t('imagePlaceholder') : '')
}

function seqKey(prefix: string, node: Record<string, unknown>): string {
  return `${prefix}:${typeof node.seq === 'number' ? node.seq : '?'}`
}

/** 节点 seq 随行（D1 折叠边界用；缺省不带）。 */
function seqOf(node: Record<string, unknown>): { seq?: number } {
  return typeof node.seq === 'number' ? { seq: node.seq } : {}
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
      return { key: seqKey('u', n), ...seqOf(n), role: 'user', text: contentTextOf(n.content) }
    case 'steering':
      return { key: seqKey('s', n), ...seqOf(n), role: 'user', text: contentTextOf(n.content) }
    case 'assistant': {
      const { text, reasoning, hasToolCall } = assistantParts(n.blocks)
      // 纯工具调用头的 assistant 节点不渲染（tool-result 节点承载工具卡片）。
      if (text === '' && reasoning === '' && hasToolCall) return null
      return {
        key: seqKey('a', n),
        ...seqOf(n),
        role: 'assistant',
        text,
        ...(reasoning !== '' ? { reasoning } : {}),
        ...(n.interrupted === true ? { interrupted: true } : {}),
      }
    }
    case 'tool-result': {
      const call = n.call as { name?: unknown; argsRaw?: unknown } | null
      const toolName = typeof call?.name === 'string'
        ? call.name
        : typeof n.callId === 'string' ? n.callId : t('toolFallback')
      const text = contentTextOf(n.content)
      return {
        key: seqKey('t', n),
        ...seqOf(n),
        role: 'tool',
        toolName,
        text,
        ...(n.isError === true ? { isError: true } : {}),
      }
    }
    case 'turn-error':
      return { key: seqKey('e', n), ...seqOf(n), role: 'error', text: typeof n.message === 'string' ? n.message : t('unknownError') }
    case 'model-retry': {
      if (n.retryState === 'cancelled') return null
      return {
        key: seqKey('r', n),
        ...seqOf(n),
        role: 'notice',
        text: t(n.retryState === 'started' ? 'modelRetryStarted' : 'modelRetryWaiting'),
      }
    }
    case 'turn-max-tokens':
      return { key: seqKey('m', n), ...seqOf(n), role: 'notice', text: t('maxTokens') }
    case 'command': {
      const name = typeof n.name === 'string' && n.name !== '' ? n.name : t('commandNameFallback')
      // args 数据源自带前导空格（「/goal x」形态），trimStart 后统一补一个空格，
      // 防止「/sidefoo」（缺分隔）或「/goal  x」（双空格）。
      const args = typeof n.args === 'string' ? n.args.trimStart() : ''
      return { key: seqKey('c', n), ...seqOf(n), role: 'notice', text: t('runCommand', { cmd: `/${name}${args === '' ? '' : ` ${args}`}` }) }
    }
    case 'compaction':
      return { key: seqKey('k', n), ...seqOf(n), role: 'notice', text: t('compacted') }
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

  // 在途工具调用（tool/call 已见、tool/result 未至；0.1.1 callView 随行，
  // 0.1.2 无 view → 从 name+argsRaw 推导）。
  if (Array.isArray(snapshot.runningCalls)) {
    for (const call of snapshot.runningCalls) {
      if (typeof call !== 'object' || call === null) continue
      const c = call as { callId?: unknown; name?: unknown; turn?: unknown; step?: unknown; callView?: unknown; argsRaw?: unknown }
      const toolName = typeof c.name === 'string' ? c.name : t('toolFallback')
      inflight.push({
        turn: typeof c.turn === 'number' ? c.turn : Number.MAX_SAFE_INTEGER,
        step: typeof c.step === 'number' ? c.step : Number.MAX_SAFE_INTEGER,
        order: 1,
        message: {
          key: `rc:${typeof c.callId === 'string' ? c.callId : '?'}`,
          role: 'tool',
          toolName,
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

/**
 * D1 父历史折叠的划分：seq <= boundarySeq 的消息为继承区（fork 时刻快照，
 * 折叠进指示卡），其余（含在途项——无 seq）为新鲜区。boundarySeq 缺省 =
 * 全新鲜（升级前老 Tab 的行为不变）。
 */
export function partitionInherited(
  messages: readonly ChatMessage[],
  boundarySeq: number | undefined,
): { inherited: ChatMessage[]; fresh: ChatMessage[] } {
  if (boundarySeq === undefined) return { inherited: [], fresh: [...messages] }
  const inherited: ChatMessage[] = []
  const fresh: ChatMessage[] = []
  for (const message of messages) {
    if (message.seq !== undefined && message.seq <= boundarySeq) inherited.push(message)
    else fresh.push(message)
  }
  return { inherited, fresh }
}
