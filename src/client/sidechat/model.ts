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
import type { Context, SidebarTab } from '../host/contracts.ts'
import type { ChatMessage } from '../chat/transcript.ts'
import { splitProtocolPrefix } from '../annotate/format.ts'
import { t } from '../locales.ts'

/** Tab 类型 id（better-sidebar 注册表键；带包前缀防冲突）。 */
export const SIDE_TAB_TYPE = 'dsh-sidenote:side'



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

/**
 * 枚举侧栏状态里的全部 Tab：splits + bottomSplits 两棵树，外加 0.16 引入的
 * 浮动窗 floats（元素形态 { id, tab, … }，tab 为窗口持有的 SidebarTab）。
 * floats 缺失（0.16 之前）时数组检查天然跳过，前后版本通吃。
 */
export function collectTabs(state: unknown): SidebarTab[] {
  if (typeof state !== 'object' || state === null) return []
  const s = state as { splits?: unknown; bottomSplits?: unknown; floats?: unknown }
  const into: SidebarTab[] = []
  walkTree(s.splits, into)
  walkTree(s.bottomSplits, into)
  if (Array.isArray(s.floats)) {
    for (const float of s.floats) {
      const tab = (float as { tab?: unknown } | null)?.tab
      if (isTab(tab)) into.push(tab)
    }
  }
  return into
}

/** 枚举当前并存的侧边聊天 Tab（树顺序 = 打开顺序的近似）。 */
export function collectSideTabs(state: unknown): SidebarTab[] {
  return collectTabs(state).filter(tab => tab.type === SIDE_TAB_TYPE)
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

/**
 * 回流「问答成对」的数据源：为每条 assistant 消息配对它在回答的用户提问。
 * 顺序扫描消息流，记录最近一条用户消息的可见文本（剥掉注释/回流协议前缀——
 * fork 历史里的主会话消息可能携带），其后每条非流式 assistant 消息都配对到它；
 * 中间的 tool/notice 节点不打断配对。此前没有用户提问（如 fork 历史结尾
 * 恰是 assistant）则不配对，回流块退化为只有 <答>。
 * 返回 Map：assistant 消息 key → 提问全文。
 */
export function pairQuestions(messages: readonly ChatMessage[]): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>()
  let pending: string | undefined
  for (const message of messages) {
    if (message.role === 'user') {
      const proto = splitProtocolPrefix(message.text)
      const visible = (proto === null ? message.text : message.text.slice(proto.length)).trim()
      pending = visible === '' ? undefined : visible
    } else if (message.role === 'assistant' && message.streaming !== true && pending !== undefined) {
      pairs.set(message.key, pending)
    }
  }
  return pairs
}
