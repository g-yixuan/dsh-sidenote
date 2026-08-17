/**
 * Structural mirror of the runtime surfaces dsh-side-chat consumes.
 *
 * Third-party plugins resolve outside the DSH monorepo's single cordis
 * instance, so upstream `declare module 'cordis'` augmentations never reach
 * our `Context` type. We mirror the runtime shapes here instead — drift from
 * upstream is contained to this file. Each section names its authority (the
 * upstream .d.ts it mirrors); extend sections as features need more surface,
 * keeping the mirror honest (only declare what actually exists at runtime).
 *
 * Authorities:
 * - betterSidebar: dsh-better-sidebar `src/client/service.ts` (+ docs/external-plugin-guide.md)
 * - sessions/workspaces: `@deepseek-ai/dsh-client-runtime` lib/types/client/contract/{sessions,session,workspaces}.d.ts
 *   (local checkout: <dsh install>/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/...)
 * - conversation input / slots: `@deepseek-ai/dsh-client-ui-conversation` / `dsh-client-ui-slots` type surfaces
 */
import type { Context as CordisContext } from 'cordis'
import type { ReactNode } from 'react'

export type SessionId = string

/** Minimal observable snapshot shape (identity-stable, useSyncExternalStore-ready). */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

// ── betterSidebar (dsh-better-sidebar client-half service) ──────────────────

export interface SessionScope {
  sessionId: SessionId
  cwd?: string
}

/** A live sidebar tab instance. `meta` is plugin-owned JSON persisted with the layout. */
export interface SidebarTab {
  id: string
  type: string
  title: string
  path?: string
  meta?: unknown
}

export interface SidebarState {
  tabs: readonly SidebarTab[]
  activeTabId?: string
  [key: string]: unknown
}

export interface SidebarSnapshot {
  sessionId?: SessionId
  state?: SidebarState
  prefs?: Record<string, unknown>
}

/** better-sidebar's store handle (external tabs treat it as opaque). */
export type SidebarStore = unknown

export interface TabComponentProps {
  ctx: Context
  store: SidebarStore
  scope: SessionScope
  tab: SidebarTab
  visible: boolean
}

export interface TabDescriptor {
  id: string
  title: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  order?: number
  hidden?: boolean
  available?: (ctx: Context, scope: SessionScope, state: SidebarState) => boolean
  single?: boolean
  dedupeKey?: (tab: SidebarTab) => string | undefined
  createTab?: (state: SidebarState) => { tab: SidebarTab; patch?: Partial<SidebarState> } | null
  badge?: (ctx: Context, scope: SessionScope, state: SidebarState) => string | number | null | undefined
  onOpen?: (tab: SidebarTab, scope: SessionScope) => void
  onActivate?: (tab: SidebarTab, scope: SessionScope) => void
  onClose?: (tab: SidebarTab, scope: SessionScope) => void
  component: (props: TabComponentProps) => ReactNode
}

export interface OpenTabSeed {
  type: string
  title?: string
  path?: string
  id?: string
  url?: string
  meta?: unknown
}

export interface BetterSidebarService {
  readonly version: string
  readonly features: readonly string[]
  registerTab(descriptor: TabDescriptor): () => void
  openTab(seed: OpenTabSeed, scope?: SessionScope): void
  closeTab(tabId: string, scope?: SessionScope): void
  activateTab(tabId: string, scope?: SessionScope): void
  updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void
  getTab(id: string): TabDescriptor | undefined
  getTabs(): readonly TabDescriptor[]
  isTabEnabled(id: string): boolean
  getSnapshot(): SidebarSnapshot
  subscribeState(listener: () => void): () => void
  subscribe(listener: () => void): () => void
}

// ── sessions (dsh-client-runtime) ────────────────────────────────────────────

export interface SessionListSnapshot {
  /** Currently selected session id. */
  current?: SessionId
  [key: string]: unknown
}

export interface ForkOptions {
  sessionId: SessionId
  atSeq?: number
  increaseTitle?: boolean
}

/** Text plus browser-owned parts; text covers everything we send today. */
export type PromptContentPart = { type: 'text'; text: string } | { type: string; [key: string]: unknown }

/**
 * Conversation read model (subset). Extend from
 * dsh-client-runtime `lib/types/client/sessions/conversation.d.ts` as needed —
 * the real shape has chat/nodes/partial/queue/running and more.
 */
export interface ConversationSnapshot {
  sessionId: SessionId
  nodes: readonly unknown[]
  running: boolean
  [key: string]: unknown
}

export interface ISession {
  readonly sessionId: SessionId
  prompt(content: PromptContentPart[], mode: 'queue' | 'steer'): Promise<unknown>
  cancel(): Promise<unknown>
  rename(title: string): Promise<unknown>
  loadOlder(): Promise<void>
  command(line: string): Promise<unknown>
}

export type SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>

export interface SessionBinding {
  session: SessionFace
}

export interface SessionsService {
  list: ObservableSnapshot<SessionListSnapshot>
  fork(opts: ForkOptions): Promise<SessionId>
  binding(id: SessionId): SessionBinding | undefined
  scope(id: SessionId): Context | undefined
  open(id: SessionId): void
}

// ── workspaces (dsh-client-runtime) ─────────────────────────────────────────

export interface WorkspacesService {
  archiveSession(sessionId: SessionId): Promise<void>
}

// ── conversation input machine (dsh-client-ui-conversation; lazy via ctx.get) ─

export interface SessionInput {
  setDraft(text: string): void
  submit(mode?: string): void
  notify(level: string, text: string): void
}

export interface ConversationService {
  input: {
    for(ctx: Context): SessionInput | undefined
  }
}

// ── Context ──────────────────────────────────────────────────────────────────

export interface Context extends CordisContext {
  betterSidebar: BetterSidebarService
  sessions: SessionsService
  workspaces: WorkspacesService
}
