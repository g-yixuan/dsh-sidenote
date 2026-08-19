/**
 * 侧边聊天的纯逻辑层：Tab 编号标题、meta 序列化/解析容错、状态树遍历、
 * 会话快照 → 消息流折叠、面板相位判定。全部无副作用，单测直接覆盖。
 *
 * 数据源事实（权威注释）：
 * - SidebarState 真实形态是 splits/bottomSplits 两棵 split/leaf 树
 *   （dsh-better-sidebar src/client/state.ts），leaf.tabs 持有 SidebarTab。
 * - ConversationSnapshot.nodes 是 ConversationNode 联合（kind 判别），
 *   partial/runningCalls 承载在途流式输出（dsh-client-runtime
 *   lib/types/client/sessions/conversation.d.ts）。
 */
import type { ConversationSnapshot, Context, SidebarTab } from '../../context-types.ts'
import { t } from '../locales.ts'

/** Tab 类型 id（better-sidebar 注册表键；带包前缀防冲突）。 */
export const SIDE_TAB_TYPE = 'dsh-sidechat:side'



// ── Tab id 与标题 ────────────────────────────────────────────────────────────

/** 多实例 Tab id：`side:<uuid>`（terminal/browser 的 createTab 铸 id 先例）。 */
export function mintSideTabId(): string {
  return `side:${crypto.randomUUID()}`
}

/**
 * 标题编号：首个「侧边」；并存时新 Tab「侧边 N」（N = 既有最大编号 + 1，
 * 从标题解析）——关掉「侧边」再新建不会重名复用「侧边 2」。
 * @param existingTitles - 创建时刻同会话侧边聊天 Tab 的标题集。
 */
export function sideTabTitle(existingTitles: readonly string[]): string {
  const base = t('tabBaseTitle')
  let max = 0
  for (const title of existingTitles) {
    // 双语兼容：语言切换后旧标题是另一种语言，两种都认（编号连续性不丢）。
    const match = /^(?:Side|侧边)(?: (\d+))?$/.exec(title)
    if (match !== null) max = Math.max(max, match[1] === undefined ? 1 : Number(match[1]))
  }
  return max <= 0 ? base : `${base} ${max + 1}`
}

// ── Tab meta（注册表首选寄存处；随布局持久化） ───────────────────────────────

/** 侧边聊天寄存在 SidebarTab.meta 上的插件自有 JSON。 */
export interface SideChatMeta {
  /** fork 出的子会话 id；缺省 = 尚未 fork（刚创建）。 */
  childId?: string
  /** fork 来源主会话 id（面板归属校验用；面板天然落在其 sidebar 状态里）。 */
  parentSessionId?: string
  /** 桥接（WI-03 划选提问）写入的待注入草稿；面板应用后清除。 */
  pendingDraft?: string
}

/**
 * 容错解析 tab.meta：布局持久化里的 meta 来自上一版本的自己，字段缺失或
 * 类型漂移一律降级为缺省，绝不抛错（刷新恢复路径不许崩）。
 */
export function parseSideChatMeta(meta: unknown): SideChatMeta {
  if (typeof meta !== 'object' || meta === null) return {}
  const raw = meta as Record<string, unknown>
  const out: SideChatMeta = {}
  if (typeof raw.childId === 'string' && raw.childId !== '') out.childId = raw.childId
  if (typeof raw.parentSessionId === 'string' && raw.parentSessionId !== '') out.parentSessionId = raw.parentSessionId
  if (typeof raw.pendingDraft === 'string' && raw.pendingDraft !== '') out.pendingDraft = raw.pendingDraft
  return out
}

/** 清除 meta.pendingDraft（其余字段原样保留）。 */
export function clearPendingDraft(meta: SideChatMeta): SideChatMeta {
  const { pendingDraft: _dropped, ...rest } = meta
  return rest
}

// ── 侧栏状态树遍历（容错：布局 JSON 漂移时不抛错） ───────────────────────────

function isTab(value: unknown): value is SidebarTab {
  if (typeof value !== 'object' || value === null) return false
  const tab = value as { id?: unknown; type?: unknown }
  return typeof tab.id === 'string' && typeof tab.type === 'string'
}

function walkTree(node: unknown, into: SidebarTab[]): void {
  if (typeof node !== 'object' || node === null) return
  const n = node as { kind?: unknown; tabs?: unknown; children?: unknown }
  if (n.kind === 'leaf') {
    if (Array.isArray(n.tabs)) for (const tab of n.tabs) if (isTab(tab)) into.push(tab)
    return
  }
  if (Array.isArray(n.children)) for (const child of n.children) walkTree(child, into)
}

/** 枚举侧栏状态（splits + bottomSplits 两棵树）里的全部 Tab。 */
export function collectTabs(state: unknown): SidebarTab[] {
  if (typeof state !== 'object' || state === null) return []
  const s = state as { splits?: unknown; bottomSplits?: unknown }
  const into: SidebarTab[] = []
  walkTree(s.splits, into)
  walkTree(s.bottomSplits, into)
  return into
}

/** 枚举当前并存的侧边聊天 Tab（树顺序 = 打开顺序的近似）。 */
export function collectSideTabs(state: unknown): SidebarTab[] {
  return collectTabs(state).filter(tab => tab.type === SIDE_TAB_TYPE)
}

/** 并存数（createTab 编号标题的输入）。 */
export function countSideTabs(state: unknown): number {
  return collectSideTabs(state).length
}

// ── fork 准入 ────────────────────────────────────────────────────────────────

/**
 * blank 着陆页会话没有已完成 turn，fork 必败（host 返回 fork-unavailable）
 * ——+ 菜单与 /side 命令的 available 用它禁用入口；面板内错误态兜底。
 * 摘要求知（列表未就绪）时放行，交给 fork 错误态。
 */
export function canForkFrom(ctx: Context, sessionId: string): boolean {
  try {
    const summary = ctx.sessions.list.getSnapshot().byId?.[sessionId]
    return summary?.blank !== true
  } catch {
    return true
  }
}

// ── 面板相位 ─────────────────────────────────────────────────────────────────

/**
 * 面板相位：
 * - forking：无 childId，fork 编排进行中（或等待 effect 起跑）；
 * - fork-error：fork/归档失败（blank 会话无已完成 turn 等）；
 * - loading：有 childId，列表未就绪或 binding 尚未可解析；
 * - missing：列表就绪后子会话不在列（会话已不存在）；
 * - chat：binding 解析成功，正常聊天。
 */
export type PanelPhase = 'forking' | 'fork-error' | 'loading' | 'missing' | 'chat'

export function phaseOf(input: {
  childId: string | undefined
  forkError: string | null
  bound: boolean
  listPhase: 'pending' | 'ready' | undefined
  listed: boolean
}): PanelPhase {
  if (input.childId === undefined) return input.forkError === null ? 'forking' : 'fork-error'
  if (input.bound) return 'chat'
  if (input.listPhase === 'ready' && !input.listed) return 'missing'
  return 'loading'
}

// ── 草稿拼接 ─────────────────────────────────────────────────────────────────

/** 注入草稿的拼接规则：空草稿直接落文本，否则换行追加（引文+问题的自然形态）。 */
export function appendDraftText(draft: string, text: string): string {
  return draft.trim() === '' ? text : `${draft}\n${text}`
}

// ── 会话快照 → 消息流折叠 ────────────────────────────────────────────────────

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
    else if (b.type === 'image') parts.push('[图片]')
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
        : typeof n.callId === 'string' ? n.callId : '工具'
      return {
        key: seqKey('t', n),
        role: 'tool',
        toolName,
        text: truncateText(contentTextOf(n.content), TOOL_TEXT_LIMIT),
        ...(n.isError === true ? { isError: true } : {}),
      }
    }
    case 'turn-error':
      return { key: seqKey('e', n), role: 'error', text: typeof n.message === 'string' ? n.message : '未知错误' }
    case 'model-retry': {
      if (n.retryState === 'cancelled') return null
      return {
        key: seqKey('r', n),
        role: 'notice',
        text: n.retryState === 'started' ? '模型请求失败，正在自动重试…' : '模型请求失败，等待自动重试…',
      }
    }
    case 'turn-max-tokens':
      return { key: seqKey('m', n), role: 'notice', text: '输出达到长度上限，本轮回复已截断。' }
    case 'command': {
      const name = typeof n.name === 'string' && n.name !== '' ? `/${n.name}` : '/命令'
      const args = typeof n.args === 'string' ? n.args : ''
      return { key: seqKey('c', n), role: 'notice', text: `执行命令 ${name}${args}` }
    }
    case 'compaction':
      return { key: seqKey('k', n), role: 'notice', text: '已压缩更早的对话上下文。' }
    default:
      // context（注入）/ unknown（未识面事件）：MVP 不渲染。
      return null
  }
}

/**
 * ConversationSnapshot → 渲染消息列表：终态节点 + 在途工具调用 + 流式部分。
 * 快照缺省（未绑定）时为空列表。
 */
export function transcriptOf(snapshot: ConversationSnapshot | undefined | null): ChatMessage[] {
  if (snapshot === undefined || snapshot === null) return []
  const out: ChatMessage[] = []
  for (const node of snapshot.nodes ?? []) {
    const message = nodeToMessage(node)
    if (message !== null) out.push(message)
  }
  // 在途工具调用（tool/call 已见、tool/result 未至）。
  if (Array.isArray(snapshot.runningCalls)) {
    for (const call of snapshot.runningCalls) {
      if (typeof call !== 'object' || call === null) continue
      const c = call as { callId?: unknown; name?: unknown }
      out.push({
        key: `rc:${typeof c.callId === 'string' ? c.callId : '?'}`,
        role: 'tool',
        toolName: typeof c.name === 'string' ? c.name : '工具',
        text: '',
        streaming: true,
      })
    }
  }
  // 流式中的 assistant 部分输出。
  const partial = snapshot.partial as { blocks?: unknown } | null | undefined
  if (partial !== undefined && partial !== null) {
    const { text, reasoning, hasToolCall } = assistantParts(partial.blocks)
    if (text !== '' || reasoning !== '' || !hasToolCall) {
      out.push({
        key: 'partial',
        role: 'assistant',
        text,
        ...(reasoning !== '' ? { reasoning } : {}),
        streaming: true,
      })
    }
  }
  return out
}
