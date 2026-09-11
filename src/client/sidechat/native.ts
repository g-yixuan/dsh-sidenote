/**
 * better-sidebar >= 0.19 / DSH 0.1.5 bridge.
 *
 * From 0.19 on, better-sidebar no longer owns the right column: it hands it to
 * DSH's native right sidebar (`dsh-client-ui-sidebar-right`) and routes tab
 * lifecycle calls to that surface (`openTab`/`activateTab`/`updateTab`).
 * Sidechat tabs opened that way never enter the legacy layout store
 * (splits/bottomSplits/floats) that `collectSideTabs` walks, so the minted tab
 * id cannot be recovered from the snapshot and the panel's `meta` cannot be
 * seeded before mounting.
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
}

/** Native tab id → live panel. Native layouts are memory-only, so is this. */
const liveSideChats = new Map<string, LiveSideChat>()

/**
 * Publish a mounted panel so programmatic entry points can focus it and seed
 * its draft. Returns the disposer for the panel's effect cleanup.
 */
export function registerLiveSideChat(
  sessionId: string,
  tabId: string,
  seedDraft: (text: string) => void,
  readMeta: () => unknown,
): () => void {
  const entry: LiveSideChat = { tabId, sessionId, seedDraft, readMeta }
  liveSideChats.set(tabId, entry)
  return () => {
    if (liveSideChats.get(tabId) === entry) liveSideChats.delete(tabId)
  }
}

/** Live panel for a native tab id (undefined for legacy layout tabs). */
export function liveSideChat(tabId: string): LiveSideChat | undefined {
  return liveSideChats.get(tabId)
}

/**
 * Most recently registered live panel of a session — the open-or-focus target
 * when the legacy snapshot cannot see the tab (mirrors "last opened wins").
 */
export function lastLiveSideChat(sessionId: string): LiveSideChat | undefined {
  let found: LiveSideChat | undefined
  for (const entry of liveSideChats.values()) {
    if (entry.sessionId === sessionId) found = entry
  }
  return found
}

/** Native tab shell for reads that go through the layout snapshot (`readTab`). */
export function nativeTabShell(tabId: string, type: string): { id: string; type: string; title: string; meta: unknown } | undefined {
  const entry = liveSideChats.get(tabId)
  if (entry === undefined) return undefined
  return { id: entry.tabId, type, title: '', meta: entry.readMeta() }
}
