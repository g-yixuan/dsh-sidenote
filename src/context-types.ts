/**
 * Structural mirror of the runtime surfaces dsh-sidechat consumes.
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

/**
 * 侧栏状态 = splits/bottomSplits 两棵 split/leaf 树（权威：dsh-better-sidebar
 * src/client/state.ts）：leaf 持有 tabs；split 递归分栏。
 */
export interface SidebarLeafNode {
  kind: 'leaf'
  id: string
  tabs: SidebarTab[]
  active: string | null
}

export interface SidebarSplitNode {
  kind: 'split'
  id: string
  dir: 'row' | 'col'
  sizes: number[]
  children: SidebarTreeNode[]
}

export type SidebarTreeNode = SidebarLeafNode | SidebarSplitNode

export interface SidebarState {
  /** 右侧面板的 split 树。 */
  splits: SidebarTreeNode
  /** 底部面板的 split 树。 */
  bottomSplits: SidebarTreeNode
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

// ── connection（dsh-client-connection；sessions RPC 直达面）──────────────────

/** 会话的当前模型选择（`session.models` 的 current 字段）。 */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface SessionModelsResult {
  current: ModelSelection
  routable: boolean
  groups: readonly unknown[]
}

export interface RpcEnvelope<T> {
  result: { ok: true; value: T } | { ok: false; error: { message?: string } }
}

export interface ConnectionSessionsApi {
  models(payload: { sessionId: SessionId }): Promise<RpcEnvelope<SessionModelsResult>>
  selectModel(payload: { sessionId: SessionId; provider: string; model: string; reasoningEffort?: string }): Promise<RpcEnvelope<{ selected: ModelSelection }>>
}

export interface ConnectionService {
  api: { sessions: ConnectionSessionsApi }
}

// ── Context ──────────────────────────────────────────────────────────────────

// ── locale（dsh-client-locale；DSH 通用设置的语言偏好，Host-backed）────────────

export interface LocaleService {
  getSnapshot(): { active: string }
  subscribe(fn: () => void): () => void
}

export interface Context extends CordisContext {
  betterSidebar: BetterSidebarService
  sessions: SessionsService
  workspaces: WorkspacesService
  connection: ConnectionService
  locale: LocaleService
}

// ── sidechat 扩展（WI-01）───────────────────────────────────────────────────
// 下列声明经接口合并补进上方镜像；权威来源逐节标注。

/**
 * 会话列表快照补全（权威：dsh-client-runtime
 * lib/types/client/sessions/service.d.ts 的 SessionListState）：
 * phase 标「首次成功拉取」就绪边；byId 含已归档行（归档过滤在
 * workspace UI 层，store 本身携带全部行）。
 */
export interface SessionListSnapshot {
  phase?: 'pending' | 'ready'
  byId?: Record<string, { blank?: boolean } | undefined>
}

/**
 * 会话快照补全（权威：dsh-client-runtime sessions/conversation.d.ts）：
 * openState 是历史窗口生命周期（cold = 未开窗口）；partial/runningCalls
 * 承载在途流式输出。面板折叠函数对三者全部容错（缺省按空处理）。
 */
export interface ConversationSnapshot {
  openState?: 'cold' | 'loading' | 'open' | 'error'
  partial?: unknown
  runningCalls?: readonly unknown[]
}

/**
 * input 草稿机的 state store（权威：dsh-client-ui-conversation
 * input/contract.d.ts 的 SessionInput.state）——完整声明见下方 annotate 扩展节
 * （接口合并；draft 字段两侧都依赖）。
 */

export interface Context {
  /**
   * 惰性非追踪服务读（运行时事实：context proxy 的 reflect.get）——
   * 读取不在 inject 清单里的服务（conversation / commandUi）的唯一通道。
   * （`ctx.effect` 无需镜像：公开 cordis 包的 fiber.d.ts 已通过接口合并
   * 提供 `effect(execute, label?)`。）
   */
  get(name: string): unknown
}

// ── annotate 扩展 ────────────────────────────────────────────────────────────
// Mirrors consumed by src/client/annotate/** (Workitem 02). Authorities:
// - slots service: `@deepseek-ai/dsh-client-runtime` lib/types/client/slots.d.ts
//   (SlotRegistry; register/inject) + `@deepseek-ai/dsh-client-ui-slots` index.d.ts
// - input.dock owner share: `@deepseek-ai/dsh-client-ui-conversation`
//   lib/types/client/contract/slots.d.ts (`conversation.input.dock` → InputZone)
// - SessionInput: `.../lib/types/client/input/contract.d.ts`

/** Registration options subset passed to `ctx.slots.register` (same shape better-sidebar mirrors). */
export interface SlotRegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string | (() => string)
  select?: (owner: unknown) => unknown
  priority?: number
  locale?: string
  registrant?: string
  inject?: (...args: any[]) => Record<string, unknown>
  children?: Record<string, unknown>
}

/** The client slots service face (register returns the disposer). */
export interface SlotsService {
  register(options: SlotRegisterOptions, component: unknown): () => void
  /** Run a callback for each declaration lifetime of a slot (no-op while undeclared). */
  inject(key: string, callback: () => (() => void) | void): () => void
}

/** Published composer input state (subset of the real InputState). */
export interface InputStateSnapshot {
  readonly draft: string
  readonly phase: string
  readonly queue?: readonly unknown[]
}

/** Session input snapshot as exposed on `InputZone.input`. */
export interface ConversationSnapshotLite {
  sessionId: SessionId
  running: boolean
}

/** Owner share of the `conversation.input.dock` slot (point-in-time snapshots). */
export interface InputZone {
  readonly session: ConversationSnapshotLite
  readonly input: InputStateSnapshot
}

/**
 * U+FFFC reference-chip insert (spike result: NOT used — serialization of the
 * chip routes through the source owner's ReferenceCodec, which is
 * package-internal to ui-input-trigger with no plugin-facing registry; an
 * unowned source would mark the occurrence invalid and fail submit. Mirrored
 * here only to document the probe target).
 */
export interface ReferenceInsert {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly clipboardText: string
}

export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

export interface Context {
  /** The slot registry (provided by dsh-client-runtime, mounted before this plugin). */
  slots: SlotsService
}

/** SessionInput completion for annotate: the live state store + the (unused) chip insert face. */
export interface SessionInput {
  /** Input state store (draft reads + subscribe for the send-edge watch). */
  readonly state: ObservableSnapshot<InputStateSnapshot>
  /** Spike-only mirror; see {@link ReferenceInsert}. Not called by annotate. */
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
}
