/**
 * 侧聊 tab 的自有 meta store（Workitem_03；直连原生腿的 meta 数据源）。
 *
 * 原生右栏（DSH ≥ 0.1.5）不替插件持久化 tab meta（布局恢复因版本而异），
 * better-sidebar 转发层的 updateTab 在 native 下本就只到 seed.meta 为止——
 * 直连后 meta 全部自管：childId 绑定、parentSessionId、pendingDraft、
 * 实例编号都落这里。
 *
 * 持久化：localStorage 按「会话 + tabId」分键（dsh-sidenote:side-meta:v1:
 * <sessionId>:<tabId>）——**键必须带会话作用域**：原生 tab id 是每会话
 * 独立计数器铸造（每个会话右栏首个 tab 都叫 tab2），裸 tabId 做键会跨
 * 会话碰撞（对抗性审查 B1）。revive 容错、空删键、写失败吞错。
 *
 * 孤键清扫：不能用旧页面键判断 tab 仍存活，而
 * 「有记录 ⇒ tab 存活」是编排层的判定——残留记录会把入口折叠成聚焦一个
 * 不存在的 tab（死锁，对抗性审查 B2）。每条记录带本页面生命周期的
 * runId，只有本页面认领的记录才算存活。sessionStorage 保留本窗口身份，
 * localStorage 提供跨窗口关闭后的恢复副本；启动时只收集恢复候选，
 * 不删除其他窗口的记录。仅 restored tab（revision 0）可认领旧身份。
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
  /** 宿主实际 fork 切点；后续插话或回复不会推进它。 */
  readonly boundarySeq?: number
  /** 首次发送仍需截取主线；沿用旧字段名以兼容已恢复的侧聊。 */
  readonly forkedMidTurn?: boolean
  /** 零完成轮兜底（Delivery_04）：主线首轮在飞无法 fork，create 出来的
   *  纯快照会话（无继承历史）。 */
  readonly snapshotOnly?: boolean
  /** 内容身份（Delivery_05）：首条用户消息摘要，sticky。 */
  readonly topic?: string
  /** 实例编号（「侧边 2」的 2；单实例期恒 1）。 */
  readonly number: number
  readonly createdAt: number
  /** 写入时的页面生命周期 id（孤键清扫判据；缺省 = 旧版记录，视为残留）。 */
  readonly runId?: string
}

const KEY_PREFIX = 'dsh-sidenote:side-meta:v1:'
// Recovery candidates never count as live tabs. Only a mounted host record
// with navigation revision 0 may reclaim one after layout restoration.
const restorationCandidates = new Map<string, SideChatMetaRecord>()

export function takeRestoredSideChatMeta(sessionId: string, tabId: string): SideChatMetaRecord | undefined {
  const key = keyOf(sessionId, tabId)
  const meta = restorationCandidates.get(key)
  restorationCandidates.delete(key)
  return meta
}

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
    ...(typeof r.topic === 'string' && r.topic !== '' ? { topic: r.topic } : {}),
    number: r.number,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    ...(typeof r.runId === 'string' ? { runId: r.runId } : {}),
  }
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function windowStorage(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage
}

function readRecord(store: Storage | null, key: string): SideChatMetaRecord | undefined {
  try { return revive(JSON.parse(store?.getItem(key) ?? 'null')) ?? undefined }
  catch { return undefined }
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
  const key = keyOf(sessionId, tabId)
  const record = readRecord(windowStorage(), key) ?? readRecord(storage(), key)
  return record?.runId === SIDENOTE_RUN_ID ? record : undefined
}

/** 写/合并一个 tab 的 meta（整体替换语义由调用方组合：先读再写）。 */
export function writeSideChatMeta(record: SideChatMetaRecord, options?: { silent?: boolean }): void {
  const value = JSON.stringify({ ...record, runId: record.runId ?? SIDENOTE_RUN_ID })
  for (const store of [windowStorage(), storage()]) {
    try { store?.setItem(keyOf(record.sessionId, record.tabId), value) }
    catch { /* The other store can still preserve this identity. */ }
  }
  if (options?.silent !== true) notify()
}

export function dropSideChatMeta(sessionId: string, tabId: string): void {
  const key = keyOf(sessionId, tabId)
  try { windowStorage()?.removeItem(key) } catch { /* ignore */ }
  try {
    const store = storage()
    if (readRecord(store, key)?.runId === SIDENOTE_RUN_ID) store?.removeItem(key)
  } catch { /* ignore */ }
  notify()
}

/** 枚举一个主会话的全部 meta 记录（按创建序升序）。 */
export function sideChatMetasOf(sessionId: string): SideChatMetaRecord[] {
  return sideChatMetasAll().filter(r => r.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt)
}

/** 枚举全部存活记录（跨会话；完成通知等全局监听用）。 */
export function sideChatMetasAll(): SideChatMetaRecord[] {
  return storedSideChatMetas().filter(record => record.runId === SIDENOTE_RUN_ID)
}

/** Durable recovery records; a window's own copy wins over another window. */
export function storedSideChatMetas(): SideChatMetaRecord[] {
  const records = new Map<string, SideChatMetaRecord>()
  for (const store of [storage(), windowStorage()]) {
    try {
      for (let i = 0; store && i < store.length; i++) {
        const key = store.key(i)
        if (!key?.startsWith(KEY_PREFIX)) continue
        const record = readRecord(store, key)
        if (record) records.set(key, record)
      }
    } catch { /* Read the other store when one is unavailable. */ }
  }
  return [...records.values()]
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
 * 启动时收集恢复候选；持久记录不作为存活证明，也不跨窗口删除。
 */
export function sweepOrphanedSideChatMeta(): number {
  restorationCandidates.clear()
  for (const record of storedSideChatMetas()) {
    if (record.runId !== SIDENOTE_RUN_ID) restorationCandidates.set(keyOf(record.sessionId, record.tabId), record)
  }
  return restorationCandidates.size
}
