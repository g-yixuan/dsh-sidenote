/**
 * 侧聊 tab 的自有 meta store（Workitem_03；直连原生腿的 meta 数据源）。
 *
 * 原生右栏（DSH ≥ 0.1.5）不替插件持久化 tab meta（布局 memory-only），
 * better-sidebar 转发层的 updateTab 在 native 下本就只到 seed.meta 为止——
 * 直连后 meta 全部自管：childId 绑定、parentSessionId、pendingDraft、
 * 实例编号都落这里。
 *
 * 持久化：localStorage 按「会话 + tabId」分键（dsh-sidenote:side-meta:v1:
 * <sessionId>:<tabId>）——**键必须带会话作用域**：原生 tab id 是每会话
 * 独立计数器铸造（每个会话右栏首个 tab 都叫 tab2），裸 tabId 做键会跨
 * 会话碰撞（对抗性审查 B1）。revive 容错、空删键、写失败吞错。
 *
 * 孤键清扫：原生布局 memory-only（页面刷新后 tab 消失、键残留），而
 * 「有记录 ⇒ tab 存活」是编排层的判定——残留记录会把入口折叠成聚焦一个
 * 不存在的 tab（死锁，对抗性审查 B2）。每条记录带本页面生命周期的
 * runId，插件 apply 时清扫 runId 不匹配的残留（sweepOrphanedSideChatMeta）。
 * 已知限制：同一 origin 开两个窗口时，后启动窗口的清扫会清掉先开窗口的
 * 活记录（其面板 reconcile 幂等重建，childId 丢失退回首开 fork）——
 * 多窗口为边角场景，记录在案。
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
  /** D1 折叠边界：fork 时刻父会话的最大节点 seq（busy fork 后推进覆盖
   *  被 cancel 的遗传 turn，允许小数——中断 turn 的冻结节点带小数 seq）。 */
  readonly boundarySeq?: number
  /** busy fork 标记（Delivery_04）：fork 时主线 turn 在飞，首条侧边消息
   *  发送时拼接主线进展快照。 */
  readonly forkedMidTurn?: boolean
  /** 零完成轮兜底（Delivery_04）：主线首轮在飞无法 fork，create 出来的
   *  纯快照会话（无继承历史）。 */
  readonly snapshotOnly?: boolean
  /** 监护判别依据（Delivery_04）：fork 时刻主线在飞消息的前缀。 */
  readonly leakedPromptPrefix?: string
  /** 遗传 turn 已中和（cancel + 边界覆盖完成）。 */
  readonly inheritedPurged?: boolean
  /** 实例编号（「侧边 2」的 2；单实例期恒 1）。 */
  readonly number: number
  readonly createdAt: number
  /** 写入时的页面生命周期 id（孤键清扫判据；缺省 = 旧版记录，视为残留）。 */
  readonly runId?: string
}

const KEY_PREFIX = 'dsh-sidenote:side-meta:v1:'

/**
 * 本页面生命周期 id。**挂在 window 上**（审查 m3）：模块级铸造会在插件
 * HMR/重载时换模块实例 → 新 runId 触发孤键清扫误删本页活记录。window
 * 级持有跨模块重载稳定；页面刷新（真正的清扫时机）window 重建。
 */
export const SIDENOTE_RUN_ID: string = (() => {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __dshSidenoteRunId?: string }
    if (w.__dshSidenoteRunId === undefined) {
      w.__dshSidenoteRunId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    return w.__dshSidenoteRunId
  }
  return `run-ssr-${Math.random().toString(36).slice(2)}`
})()

function keyOf(sessionId: string, tabId: string): string {
  return `${KEY_PREFIX}${sessionId}:${tabId}`
}

function revive(value: unknown): SideChatMetaRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.sessionId !== 'string' || r.sessionId === '') return null
  if (typeof r.tabId !== 'string' || r.tabId === '') return null
  if (typeof r.number !== 'number') return null
  return {
    tabId: r.tabId,
    sessionId: r.sessionId,
    ...(typeof r.childId === 'string' ? { childId: r.childId } : {}),
    ...(typeof r.parentSessionId === 'string' ? { parentSessionId: r.parentSessionId } : {}),
    ...(typeof r.pendingDraft === 'string' ? { pendingDraft: r.pendingDraft } : {}),
    ...(typeof r.boundarySeq === 'number' && Number.isFinite(r.boundarySeq) ? { boundarySeq: r.boundarySeq } : {}),
    ...(r.forkedMidTurn === true ? { forkedMidTurn: true } : {}),
    ...(r.snapshotOnly === true ? { snapshotOnly: true } : {}),
    ...(typeof r.leakedPromptPrefix === 'string' ? { leakedPromptPrefix: r.leakedPromptPrefix } : {}),
    ...(r.inheritedPurged === true ? { inheritedPurged: true } : {}),
    number: r.number,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    ...(typeof r.runId === 'string' ? { runId: r.runId } : {}),
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

export function readSideChatMeta(sessionId: string, tabId: string): SideChatMetaRecord | undefined {
  const store = storage()
  if (store === null) return undefined
  try {
    const raw = store.getItem(keyOf(sessionId, tabId))
    if (raw === null) return undefined
    return revive(JSON.parse(raw)) ?? undefined
  } catch {
    return undefined
  }
}

/** 写/合并一个 tab 的 meta（整体替换语义由调用方组合：先读再写）。 */
export function writeSideChatMeta(record: SideChatMetaRecord, options?: { silent?: boolean }): void {
  const store = storage()
  if (store === null) return
  try {
    store.setItem(keyOf(record.sessionId, record.tabId), JSON.stringify(record))
    if (options?.silent !== true) notify()
  } catch { /* 隐私模式/写失败：meta 缺席降级为无绑定首开 */ }
}

export function dropSideChatMeta(sessionId: string, tabId: string): void {
  const store = storage()
  if (store === null) return
  try {
    store.removeItem(keyOf(sessionId, tabId))
    notify()
  } catch { /* ignore */ }
}

/** 枚举一个主会话的全部 meta 记录（按创建序升序）。 */
export function sideChatMetasOf(sessionId: string): SideChatMetaRecord[] {
  return sideChatMetasAll().filter(r => r.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt)
}

/** 枚举全部存活记录（跨会话；完成通知等全局监听用）。 */
export function sideChatMetasAll(): SideChatMetaRecord[] {
  const store = storage()
  if (store === null) return []
  try {
    const out: SideChatMetaRecord[] = []
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) continue
      const record = revive(JSON.parse(store.getItem(key) ?? 'null'))
      if (record !== null) out.push(record)
    }
    return out
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

/**
 * 孤键清扫：删掉 runId 与本页面生命周期不匹配的记录（上一页面周期的
 * 残留——原生布局刷新即空，这些键指向的 tab 已不存在）。插件 apply 时
 * 调用一次。返回清扫数。
 */
export function sweepOrphanedSideChatMeta(): number {
  const store = storage()
  if (store === null) return 0
  try {
    const staleKeys: string[] = []
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) continue
      const record = revive(JSON.parse(store.getItem(key) ?? 'null'))
      if (record === null || record.runId !== SIDENOTE_RUN_ID) staleKeys.push(key)
    }
    for (const key of staleKeys) store.removeItem(key)
    if (staleKeys.length > 0) notify()
    return staleKeys.length
  } catch {
    return 0
  }
}
