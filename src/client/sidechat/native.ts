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

/** better-sidebar version that moved the right column to DSH's native sidebar. */
const NATIVE_SIDEBAR_MINOR = 19

let root: Context | undefined

/** Remember the plugin root context at activation (see module docstring). */
export function setRootContext(ctx: Context): void {
  root = ctx
}

/** Plugin root context; falls back to the caller's context (legacy behaviour). */
export function rootContext(fallback: Context): Context {
  return root ?? fallback
}

/**
 * True when the host keeps sidebar tabs outside the legacy layout store
 * (better-sidebar >= 0.19). Version parse is best-effort: an unparsable
 * version reports false, which keeps the pre-0.19 behaviour.
 */
export function nativeSidebarHost(ctx: Context): boolean {
  try {
    const [major = 0, minor = 0] = ctx.betterSidebar.version.split('.').map(part => Number.parseInt(part, 10))
    return major > 0 || minor >= NATIVE_SIDEBAR_MINOR
  } catch {
    return false
  }
}

interface LiveSideChat {
  readonly tabId: string
  readonly sessionId: string
  /** Write text into the panel composer (draft delivery). */
  seedDraft(text: string): void
  /** Current tab meta, read at call time (the panel re-renders on meta change). */
  readMeta(): unknown
  /** Current tab title（聚焦列表/编号数据源的读取面）。 */
  readTitle(): string
}

/** Native tab id → live panel. Native layouts are memory-only, so is this. */
const liveSideChats = new Map<string, LiveSideChat>()

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
): () => void {
  const entry: LiveSideChat = { tabId, sessionId, seedDraft, readMeta, readTitle }
  liveSideChats.set(tabId, entry)
  if (!birthOrder.has(tabId)) birthOrder.set(tabId, ++birthSeq)
  // 挂载即回放在 openTab→注册窗口内暂存的草稿（seedDraft 内有相位门）。
  const opening = openings.get(sessionId)
  if (opening !== undefined) {
    openings.delete(sessionId)
    for (const draft of opening.drafts) seedDraft(draft)
  }
  return () => {
    if (liveSideChats.get(tabId) === entry) liveSideChats.delete(tabId)
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
export function liveSideChat(tabId: string): LiveSideChat | undefined {
  return liveSideChats.get(tabId)
}

/** 一个会话的全部存活面板（按打开序升序；native 下枚举 side tab 的唯一数据源）。 */
export function liveSideChatsOf(sessionId: string): LiveSideChat[] {
  return [...liveSideChats.values()]
    .filter(entry => entry.sessionId === sessionId)
    .sort((a, b) => (birthOrder.get(a.tabId) ?? 0) - (birthOrder.get(b.tabId) ?? 0))
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
  root = undefined
  liveSideChats.clear()
  openings.clear()
  birthOrder.clear()
}

/** Native tab shell for reads that go through the layout snapshot (`readTab`). */
export function nativeTabShell(tabId: string, type: string): { id: string; type: string; title: string; meta: unknown } | undefined {
  const entry = liveSideChats.get(tabId)
  if (entry === undefined) return undefined
  return { id: entry.tabId, type, title: '', meta: entry.readMeta() }
}

/**
 * 聚焦一个 native tab：better-sidebar >= 0.19 的 `surface.activate` 是空操作
 * （只返回记录存在性——authority: dsh-better-sidebar src/client/native/surface.ts），
 * 真实聚焦面是 dsh 0.1.5 的 `ISidebarRight.focus`（authority:
 * dsh-client-ui-sidebar-right lib/types/client/service.d.ts `focus(tabId)`）。
 * focus 只标记活动 tab/pane，不展开折叠的栏——聚焦的语义包含「让用户看见」，
 * 故折叠时补 toggleExpanded（authority: 同文件 `isExpanded/toggleExpanded`）。
 * @returns true = 已通过 focus 聚焦；false = 面缺席（调用方回退 activateTab）。
 */
export function focusNativeTab(ctx: Context, tabId: string): boolean {
  try {
    const face = ctx.get('sidebarRight') as {
      focus?: (id: string) => void
      isExpanded?: () => boolean
      toggleExpanded?: () => void
    } | undefined
    if (typeof face?.focus !== 'function') return false
    face.focus(tabId)
    if (face.isExpanded?.() === false) face.toggleExpanded?.()
    return true
  } catch {
    return false
  }
}
