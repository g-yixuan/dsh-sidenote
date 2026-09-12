/**
 * 侧边聊天的宿主接线层（L3）：fork 编排 / 归档 / 模型同步 / Tab meta 读写 /
 * 面板展开 / 会话窗口打开。SideChatPanel（L2）只调这里的编排函数，
 * 不直接碰宿主 RPC（WI-00 分层纪律：L2 无直接宿主调用）。
 *
 * off-face 探测纪律：session.open()、store.update 均为运行时可达但契约不
 * 保证的面——就地 feature-check + 吞错降级，并登记进 host/probes.ts。
 */
import type { Context, ConversationSnapshot, ModelSelection, RemoteSessionModelFace, SessionBinding, SessionFace, SessionModelsResult, UiConversationLike } from '../host/contracts.ts'
import { parseSideChatMeta, type SideChatMeta } from './model.ts'
import { readTab } from './open.ts'
import { rootContext } from './native.ts'

/**
 * 首开编排：fork（全量历史快照）→ 登记 meta（先行，绝不丢登记）→
 * 归档隐藏出会话列表（best-effort）→ 模型跟随主会话（best-effort）。
 * fork 失败抛错（面板组件转错误态）；后两步失败只告警不阻断。
 * @returns fork 出的子会话 id。
 */
export async function forkAndRegister(ctx: Context, parentSessionId: string, tabId: string): Promise<string> {
  // D1 折叠边界：fork 前读父会话当前最大节点 seq（fork 继承的内容到此为止）。
  // 读取走 chatSourceOf 双兼容面（0.1.2 的 Session 快照已无 nodes 顶层字段，
  // 内容在 uiConversation.legacy——直读 Session 会静默拿不到边界）。
  let boundarySeq: number | undefined
  try {
    const source = chatSourceOf(ctx, ctx.sessions.binding(parentSessionId))
    const snap = source?.getLegacy()
    let max = -1
    for (const node of snap?.nodes ?? []) {
      const seq = (node as { seq?: unknown }).seq
      if (typeof seq === 'number' && seq > max) max = seq
    }
    if (max >= 0) boundarySeq = max
  } catch {
    // 边界缺失不阻断 fork。
  }
  const forked = await ctx.sessions.fork({ sessionId: parentSessionId })
  // The slot-provided context a panel receives has a narrower inject list than the
  // plugin root context, so host calls go through the root context (see native.ts).
  const owner = rootContext(ctx)
  // meta 先行：fork resolve 后立即登记 childId（会话切换导致组件卸载时
  // updateTab 找不到 tab 也只是 no-op——否则 Tab 永远停在 forking 且下次
  // 挂载重复 fork 出孤儿会话）。
  updateTabMeta(ctx, tabId, (current) => ({
    ...current,
    childId: forked,
    parentSessionId,
    ...(boundarySeq !== undefined ? { boundarySeq } : {}),
  }))
  // 归档失败残留可见（无 unarchive API），不阻断面板。
  try {
    await owner.workspaces.archiveSession(forked)
  } catch (error) {
    console.warn('[dsh-sidenote] 归档侧边会话失败（会话列表可能短暂可见）:', error)
  }
  // fork 继承 agent preset 但不继承模型选择——读主会话当前模型并同步到
  // 子会话（best-effort，失败则子会话用宿主默认模型，面板标签如实回退）。
  // 双版本链：投影 + remote.session（0.1.5）优先，connection.api（<= 0.1.2
  // client 面）回退——面迁移不弃旧档（chatSourceOf 先例）。
  try {
    const selection = await readModelSelection(owner, parentSessionId)
    if (selection === undefined) {
      console.warn('[dsh-sidenote] 同步主会话模型跳过：主机模型 API 不可用')
    } else if (!(await writeModelSelection(owner, forked, selection))) {
      console.warn('[dsh-sidenote] 同步主会话模型失败（子会话用默认模型）')
    }
  } catch (error) {
    console.warn('[dsh-sidenote] 同步主会话模型失败（子会话用默认模型）:', error)
  }
  return forked
}

/** Tab meta 读-改-写（布局持久化寄存处）；tab 已消失时 no-op。 */
export function updateTabMeta(ctx: Context, tabId: string, mutate: (meta: SideChatMeta) => SideChatMeta): void {
  const current = parseSideChatMeta(readTab(ctx, tabId)?.meta)
  ctx.betterSidebar.updateTab(tabId, { meta: mutate(current) })
}

/**
 * 程序化入口（/side、bridge 划选提问）打开 Tab 时面板可能处于折叠态——
 * 类型型 openTab 不自动展开（better-sidebar 只对 path/url 内容型打开展开）。
 * 幂等展开（off-face：store.update 是 SidebarStore 公开 mutator 面；
 * feature-check + 吞错，兜底失败不影响功能）。
 */
export function ensurePanelOpen(store: unknown): void {
  const mutable = store as { update?: (mutate: (state: { panelOpen?: boolean }) => void) => void } | undefined
  try {
    mutable?.update?.((state) => {
      if (state.panelOpen === false) state.panelOpen = true
    })
  } catch {
    // 手动展开即可。
  }
}

/**
 * 打开非 staged 会话的事件窗口（off-face：open() 在 concrete Session 上是
 * public 且幂等，但不在 SessionFace 契约上——契约面只有 staged 会话会被
 * 运行时自动 open）。feature-check + 吞错，运行时若移除则降级为只发不收。
 */
export function openSessionWindow(session: SessionFace | undefined): void {
  const openable = session as unknown as { open?: () => Promise<void> } | undefined
  if (typeof openable?.open !== 'function') return
  openable.open().catch((error: unknown) => {
    console.warn('[dsh-sidenote] 会话窗口打开失败:', error)
  })
}

/**
 * Current model selection of a session, read from its `modelSelection`
 * projection (dsh >= 0.1.2): the durable selection is projected state, so no RPC
 * is needed and the read is safe for any session id. Snapshot shape authority:
 * `@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts`
 * (`ModelSelectionProjection = { lastUsed, next }`，两者均可为 null——
 * `next` 缺省时按投影文档回落 `lastUsed`）。
 */
export function projectedModelSelection(ctx: Context, sessionId: string): ModelSelection | undefined {
  try {
    const session = ctx.sessions.binding(sessionId)?.session as
      | { projections?: { faceOf?: (name: string) => { getSnapshot?: () => unknown } | undefined } }
      | undefined
    const snapshot = session?.projections?.faceOf?.('modelSelection')?.getSnapshot?.() as
      | { next?: ModelSelection | null; lastUsed?: ModelSelection | null }
      | undefined
    return snapshot?.next ?? snapshot?.lastUsed ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Remote session face carrying `selectModel`/`modelCatalog`（dsh 0.1.5 删除
 * `connection.api.sessions.*` client 面后的模型 RPC 面；事实上 0.1.2-rc.1
 * 起存在——authority: dsh-api-session-controller lib/typert.remote-client.d.ts）。
 * 探测走 `ctx.get`（cordis 的 get 不受 inject 门禁限制，本插件为兼容旧宿主
 * 不声明 inject 'remote.session'；机制见 contracts.ts RemoteSessionModelFace）。
 * `ctx.get('remote')` 返回命名空间容器时下钻其 `.session` 成员。
 */
export function remoteSessionFace(ctx: Context): RemoteSessionModelFace | undefined {
  for (const name of ['remote.session', 'remote']) {
    let candidate: unknown
    try {
      candidate = ctx.get(name)
    } catch {
      continue // service absent
    }
    const face = candidate as { selectModel?: unknown; session?: { selectModel?: unknown } } | undefined
    if (typeof face?.selectModel === 'function') return face as RemoteSessionModelFace
    if (typeof face?.session?.selectModel === 'function') return face.session as RemoteSessionModelFace
  }
  return undefined
}

/**
 * 读会话当前模型选择：投影面（0.1.2+，同步无 RPC）优先；旧
 * `connection.api.sessions.models` RPC（<= 0.1.2 的 client 面，0.1.5 已删）
 * 回退（双版本链，同 chatSourceOf 先例）。永不抛错。
 */
export async function readModelSelection(ctx: Context, sessionId: string): Promise<ModelSelection | undefined> {
  const projected = projectedModelSelection(ctx, sessionId)
  if (projected !== undefined) return projected
  try {
    const res = await ctx.connection.api.sessions.models({ sessionId })
    if (res.result.ok) return res.result.value.current
  } catch {
    // 旧面缺席（0.1.5）→ undefined。
  }
  return undefined
}

/**
 * 写会话模型选择：`remote.session.selectModel`（新面）优先，旧
 * `connection.api.sessions.selectModel` 回退。面在而调用失败（模型不可路由等）
 * 属真实失败，不再落旧面重试。
 */
export async function writeModelSelection(ctx: Context, sessionId: string, selection: ModelSelection): Promise<boolean> {
  const request = {
    sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
  }
  const face = remoteSessionFace(ctx)
  if (face !== undefined) {
    try {
      return (await face.selectModel(request)).ok
    } catch {
      return false
    }
  }
  try {
    const res = await ctx.connection.api.sessions.selectModel(request)
    return res.result.ok
  } catch {
    return false
  }
}

/** 读子会话当前模型名（composer 模型标签用）；任何失败回退 null（默认文案）。 */
export async function readModelName(ctx: Context, sessionId: string): Promise<string | null> {
  const selection = await readModelSelection(ctx, sessionId)
  return selection?.model ?? null
}

/** 会话内容读取源（0.1.1/0.1.2 双兼容，feature-check 优先链）。 */
export interface ChatSource {
  subscribe(fn: () => void): () => void
  /** 当前内容快照（含 nodes/partial/runningCalls 的形态）；miss 时 null。 */
  getLegacy(): ConversationSnapshot | null
}

/**
 * 0.1.2 优先：`uiConversation` 服务 → binding(会话 binding) → target('chat')
 * → 快照 .legacy 切片（0.1.2 把内容面从 Session 快照顶层拆到此处——
 * 根因与证据见 reports/ux-review/W00-fork-replay-012.md）；0.1.1 回退
 * Session 快照顶层（nodes 直接在）。均 miss 返回 undefined（面板维持
 * 既有降级，不崩）。
 */
export function chatSourceOf(ctx: Context, binding: SessionBinding | undefined): ChatSource | undefined {
  const session = binding?.session
  if (session === undefined) return undefined
  // 面 1（0.1.2+）：uiConversation.chat target。binding() 对未知会话 throw——必须 try/catch。
  try {
    const ui = ctx.get('uiConversation') as UiConversationLike | undefined
    const target = ui?.binding?.(binding)?.target?.('chat')
    if (target !== undefined && typeof target.getSnapshot === 'function' && typeof target.subscribe === 'function') {
      return {
        subscribe: (fn) => target.subscribe(fn),
        getLegacy: () => {
          const snap = target.getSnapshot() as { legacy?: ConversationSnapshot } | undefined
          return snap?.legacy ?? null
        },
      }
    }
  } catch {
    // 落面 2。
  }
  // 面 2（0.1.1）：Session 快照顶层自带 nodes。
  const snap = session.getSnapshot() as ConversationSnapshot | null
  if (snap !== null && Array.isArray(snap.nodes)) {
    return { subscribe: (fn) => session.subscribe(fn), getLegacy: () => session.getSnapshot() }
  }
  return undefined
}

/**
 * 拉会话模型目录：0.1.5 走 `remote.session.modelCatalog()`（目录是宿主级，
 * 菜单选中项所需的 current 由投影/旧面补上）；旧面回退
 * `connection.api.sessions.models`。失败 null → 菜单保持只读标签态。
 */
export async function listModels(ctx: Context, sessionId: string): Promise<SessionModelsResult | null> {
  const face = remoteSessionFace(ctx)
  if (typeof face?.modelCatalog === 'function') {
    try {
      const result = await face.modelCatalog()
      if (result.ok) {
        const catalog = result.value
        const current = (await readModelSelection(ctx, sessionId)) ?? catalog.default
        return {
          current,
          routable: catalog.routableProviders.length > 0,
          groups: catalog.groups,
          ...(catalog.failures !== undefined ? { failures: catalog.failures } : {}),
        }
      }
    } catch {
      // 落旧面。
    }
  }
  try {
    const res = await ctx.connection.api.sessions.models({ sessionId })
    return res.result.ok ? res.result.value : null
  } catch {
    return null
  }
}

/** 切换子会话模型；成功返回新模型展示名，失败 null（best-effort）。 */
export async function switchModel(ctx: Context, sessionId: string, provider: string, model: string): Promise<string | null> {
  const ok = await writeModelSelection(ctx, sessionId, { provider, model })
  return ok ? model : null
}
