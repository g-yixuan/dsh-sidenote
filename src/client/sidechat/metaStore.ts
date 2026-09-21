/**
 * 侧聊 tab 的自有 meta store（Workitem_03；直连原生腿的 meta 数据源）。
 *
 * 原生右栏（DSH ≥ 0.1.5）不替插件持久化 tab meta（布局 memory-only），
 * better-sidebar 转发层的 updateTab 在 native 下本就只到 seed.meta 为止——
 * 直连后 meta 全部自管：childId 绑定、parentSessionId、pendingDraft、
 * 实例编号与标题都落这里。
 *
 * 持久化：localStorage 按 tabId 分键（dsh-sidenote:side-meta:v1:<tabId>），
 * recentClosed 同款纪律（容错 revive、空删键、写失败不炸主流程）。
 * 原生布局本身是 memory-only（刷新后 tab 消失），所以本 store 的持久化
 * 只服务于「同一次页面生命周期内的重挂载」与「后悔药 reopen 读旧 meta」；
 * 孤键（tab 已不在布局）由面板挂载时的 reconcile 清场。
 */
export interface SideChatMetaRecord {
  readonly tabId: string
  /** 所属主会话。 */
  readonly sessionId: string
  /** fork 出的子会话（首开 fork 完成后登记）。 */
  readonly childId?: string
  readonly parentSessionId?: string
  /** 待投递草稿（面板 composer 就绪后应用并清除）。 */
  readonly pendingDraft?: string
  /** D1 折叠边界：fork 时刻父会话的最大节点 seq。 */
  readonly boundarySeq?: number
  /** 实例编号（「侧边 2」的 2；单实例期恒 1）。 */
  readonly number: number
  readonly createdAt: number
}

const KEY_PREFIX = 'dsh-sidenote:side-meta:v1:'

function revive(tabId: string, value: unknown): SideChatMetaRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.sessionId !== 'string' || r.sessionId === '') return null
  if (typeof r.number !== 'number') return null
  return {
    tabId,
    sessionId: r.sessionId,
    ...(typeof r.childId === 'string' ? { childId: r.childId } : {}),
    ...(typeof r.parentSessionId === 'string' ? { parentSessionId: r.parentSessionId } : {}),
    ...(typeof r.pendingDraft === 'string' ? { pendingDraft: r.pendingDraft } : {}),
    ...(typeof r.boundarySeq === 'number' && Number.isInteger(r.boundarySeq) ? { boundarySeq: r.boundarySeq } : {}),
    number: r.number,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  }
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

// ── 变更订阅（标题槽活渲染用；版本号单调递增即可，不区分键） ──────────────────

let version = 0
const listeners = new Set<() => void>()

function notify(): void {
  version += 1
  for (const fn of [...listeners]) fn()
}

/** useSyncExternalStore 三件套。 */
export const sideChatMetaStore = {
  getSnapshot: (): number => version,
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
}

/** 渲染期静默写后的补通知（面板 reconcile 用——render 期写不能 notify）。 */
export function notifySideChatMetaListeners(): void {
  notify()
}

export function readSideChatMeta(tabId: string): SideChatMetaRecord | undefined {
  const store = storage()
  if (store === null) return undefined
  try {
    const raw = store.getItem(KEY_PREFIX + tabId)
    if (raw === null) return undefined
    return revive(tabId, JSON.parse(raw)) ?? undefined
  } catch {
    return undefined
  }
}

/** 写/合并一个 tab 的 meta（整体替换语义由调用方组合：先读再写）。 */
export function writeSideChatMeta(record: SideChatMetaRecord, options?: { silent?: boolean }): void {
  const store = storage()
  if (store === null) return
  try {
    store.setItem(KEY_PREFIX + record.tabId, JSON.stringify(record))
    if (options?.silent !== true) notify()
  } catch { /* 隐私模式/写失败：meta 缺席降级为无绑定首开 */ }
}

export function dropSideChatMeta(tabId: string): void {
  const store = storage()
  if (store === null) return
  try {
    store.removeItem(KEY_PREFIX + tabId)
    notify()
  } catch { /* ignore */ }
}

/** 枚举一个主会话的全部 meta 记录（按创建序升序）。 */
export function sideChatMetasOf(sessionId: string): SideChatMetaRecord[] {
  const store = storage()
  if (store === null) return []
  try {
    const out: SideChatMetaRecord[] = []
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) continue
      const record = revive(key.slice(KEY_PREFIX.length), JSON.parse(store.getItem(key) ?? 'null'))
      if (record !== null && record.sessionId === sessionId) out.push(record)
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

/**
 * 下一个实例编号：当前会话存活记录的最大编号 + 1。
 * 单实例期调用方保证同会话同时至多一条存活记录（held 规则），
 * 此函数为 Delivery_02 的多实例预留正确语义。
 */
export function nextSideChatNumber(sessionId: string): number {
  const existing = sideChatMetasOf(sessionId)
  return existing.length === 0 ? 1 : Math.max(...existing.map(r => r.number)) + 1
}
