/**
 * better-sidebar >= 0.19 / DSH 0.1.5 bridge.
 *
 * From 0.19 on, better-sidebar no longer owns the right column: it hands it to
 * DSH's native right sidebar (`dsh-client-ui-sidebar-right`) and routes tab
 * lifecycle calls to that surface (`openTab`/`activateTab`/`updateTab`).
 * Sidechat tabs opened that way never enter the legacy layout store
 * (splits/bottomSplits/floats) that `collectSideTabs` walks, so the minted tab
 * id cannot be recovered from the snapshot — after `openTab` there is no
 * `updateTab` target until the panel mounts and publishes itself. Drafts must
 * therefore ride the `openTab` seed.meta (which the native surface honors) or
 * wait for the panel's registration.
 *
 * This module keeps that missing link: a registry of live side-chat panels
 * (their native tab id, their draft sink, their current meta) plus a lazy
 * root-context holder. The root context is the plugin's own fiber — unlike the
 * slot-provided context a panel receives, its inject list contains
 * `workspaces`, so host calls made from it keep working on 0.1.5.
 *
 * Authority: dsh-better-sidebar `src/client/service.ts` (>= 0.19 surface
 * routing) and `@deepseek-ai/dsh-api-session-controller` (remote session face).
 */
import type { Context } from '../host/contracts.ts'

import { clearRootContext } from '../host/sidebar.ts'
export { setRootContext, rootContext, betterSidebarOf, directNativeLeg, nativeSidebarHost, focusNativeTab } from '../host/sidebar.ts'

interface LiveSideChat {
  readonly tabId: string
  readonly sessionId: string
  /** Write text into the panel composer (draft delivery). */
  seedDraft(text: string): void
  /** Current tab meta, read at call time (the panel re-renders on meta change). */
  readMeta(): unknown
  /** Current tab title（聚焦列表/编号数据源的读取面）。 */
  readTitle(): string
  readStatus(): { phase: string; childId?: string; error?: string; requestId?: string }
}

/** Native tab id → live panel. Native layouts are memory-only, so is this. */
const liveSideChats = new Map<string, LiveSideChat>()
const panelKey = (sessionId: string, tabId: string): string => JSON.stringify([sessionId, tabId])
const liveListeners = new Set<() => void>()
export function notifyLiveSideChats(): void { for (const listener of [...liveListeners]) listener() }
export function subscribeLiveSideChats(listener: () => void): () => void {
  liveListeners.add(listener)
  return () => { liveListeners.delete(listener) }
}

/**
 * tabId → 首次注册序号（打开序的近似）。tab.id 跨重挂载稳定，重注册不改写
 * ——遍历 Map 的插入序会随重挂漂移，「最近打开」只能锚在首次序号上。
 */
const birthOrder = new Map<string, number>()
let birthSeq = 0

/**
 * Publish a mounted panel so programmatic entry points can focus it and seed
 * its draft. Returns the disposer for the panel's effect cleanup.
 */
export function registerLiveSideChat(
  sessionId: string,
  tabId: string,
  seedDraft: (text: string) => void,
  readMeta: () => unknown,
  readTitle: () => string,
  readStatus: LiveSideChat['readStatus'] = () => ({ phase: 'loading' }),
): () => void {
  const entry: LiveSideChat = { tabId, sessionId, seedDraft, readMeta, readTitle, readStatus }
  const key = panelKey(sessionId, tabId)
  liveSideChats.set(key, entry)
  if (!birthOrder.has(key)) birthOrder.set(key, ++birthSeq)
  // 挂载即回放在 openTab→注册窗口内暂存的草稿（seedDraft 内有相位门）。
  const opening = openings.get(sessionId)
  if (opening !== undefined) {
    opening.target = entry
    openings.delete(sessionId)
    for (const draft of opening.drafts) seedDraft(draft)
  }
  notifyLiveSideChats()
  return () => {
    if (liveSideChats.get(key) === entry) liveSideChats.delete(key)
    notifyLiveSideChats()
  }
}

// ── openTab→面板挂载窗口的 in-flight 标记 ────────────────────────────────────
// native tab 铸造后对布局快照与 registry 同时不可见，直到面板挂载登记；窗口内
// 的重复触发必须落进标记（草稿暂存、注册时回放），而不是再开一个 tab
// （双开 = 双 fork 出孤儿会话）。legacy 宿主无此窗口（openTab 同步落快照）。

/** 标记失效应力：openTab 被静默拒绝/面板未挂载时，超时后允许重试。 */
const OPENING_TTL_MS = 10_000

interface OpeningMark {
  readonly at: number
  /** 窗口内到达的待投递草稿（面板注册时经 seedDraft 回放）。 */
  readonly drafts: string[]
  target?: LiveSideChat
}

const openings = new Map<string, OpeningMark>()

/** 标记一次已发起、面板尚未注册的 native 打开（create/reopen 铸造后调用）。 */
export function markSideChatOpening(sessionId: string): void {
  openings.set(sessionId, { at: Date.now(), drafts: [] })
}

/** 进行中的打开；TTL 外视为 openTab 被拒/面板未挂载，清除并返回 undefined。 */
export function sideChatOpening(sessionId: string): OpeningMark | undefined {
  const mark = openings.get(sessionId)
  if (mark === undefined) return undefined
  if (Date.now() - mark.at > OPENING_TTL_MS) {
    openings.delete(sessionId)
    return undefined
  }
  return mark
}

/** Live panel for a native tab id (undefined for legacy layout tabs). */
export function liveSideChat(tabId: string, sessionId?: string): LiveSideChat | undefined {
  if (sessionId !== undefined) return liveSideChats.get(panelKey(sessionId, tabId))
  const candidates = [...liveSideChats.values()].filter(panel => panel.tabId === tabId)
  return candidates.length === 1 ? candidates[0] : undefined
}

/** 一个会话的全部存活面板（按打开序升序；native 下枚举 side tab 的唯一数据源）。 */
export function liveSideChatsOf(sessionId: string): LiveSideChat[] {
  return [...liveSideChats.values()]
    .filter(entry => entry.sessionId === sessionId)
    .sort((a, b) => (birthOrder.get(panelKey(a.sessionId, a.tabId)) ?? 0) - (birthOrder.get(panelKey(b.sessionId, b.tabId)) ?? 0))
}

/**
 * Most recently OPENED live panel of a session — the open-or-focus target
 * when the legacy snapshot cannot see the tab (mirrors "last opened wins").
 * 排序锚在首次注册序号上：面板重挂载不翻序（见 birthOrder）。
 */
export function lastLiveSideChat(sessionId: string): LiveSideChat | undefined {
  const all = liveSideChatsOf(sessionId)
  return all[all.length - 1]
}

/** 插件卸载/重载时清场（apply 的 ctx.effect disposer 调用）。 */
export function clearNativeRuntime(): void {
  clearRootContext()
  liveSideChats.clear()
  openings.clear()
  birthOrder.clear()
  notifyLiveSideChats()
}

/** Native tab shell for reads that go through the layout snapshot (`readTab`). */
export function nativeTabShell(tabId: string, type: string, sessionId?: string): { id: string; type: string; title: string; meta: unknown } | undefined {
  const entry = liveSideChat(tabId, sessionId)
  if (entry === undefined) return undefined
  return { id: entry.tabId, type, title: '', meta: entry.readMeta() }
}
