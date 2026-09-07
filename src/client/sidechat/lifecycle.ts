/**
 * 侧边聊天的宿主接线层（L3）：fork 编排 / 归档 / 模型同步 / Tab meta 读写 /
 * 面板展开 / 会话窗口打开。SideChatPanel（L2）只调这里的编排函数，
 * 不直接碰宿主 RPC（WI-00 分层纪律：L2 无直接宿主调用）。
 *
 * off-face 探测纪律：session.open()、store.update 均为运行时可达但契约不
 * 保证的面——就地 feature-check + 吞错降级，并登记进 host/probes.ts。
 */
import type { Context, SessionFace } from '../host/contracts.ts'
import { parseSideChatMeta, type SideChatMeta } from './model.ts'
import { readTab } from './open.ts'

/**
 * 首开编排：fork（全量历史快照）→ 登记 meta（先行，绝不丢登记）→
 * 归档隐藏出会话列表（best-effort）→ 模型跟随主会话（best-effort）。
 * fork 失败抛错（面板组件转错误态）；后两步失败只告警不阻断。
 * @returns fork 出的子会话 id。
 */
export async function forkAndRegister(ctx: Context, parentSessionId: string, tabId: string): Promise<string> {
  const forked = await ctx.sessions.fork({ sessionId: parentSessionId })
  // meta 先行：fork resolve 后立即登记 childId（会话切换导致组件卸载时
  // updateTab 找不到 tab 也只是 no-op——否则 Tab 永远停在 forking 且下次
  // 挂载重复 fork 出孤儿会话）。
  updateTabMeta(ctx, tabId, (current) => ({ ...current, childId: forked, parentSessionId }))
  // 归档失败残留可见（无 unarchive API），不阻断面板。
  try {
    await ctx.workspaces.archiveSession(forked)
  } catch (error) {
    console.warn('[dsh-sidenote] 归档侧边会话失败（会话列表可能短暂可见）:', error)
  }
  // fork 继承 agent preset 但不继承模型选择——读主会话当前模型并同步到
  // 子会话（best-effort，失败则子会话用宿主默认模型，面板标签如实回退）。
  try {
    const parentModels = await ctx.connection.api.sessions.models({ sessionId: parentSessionId })
    if (parentModels.result.ok) {
      const current = parentModels.result.value.current
      await ctx.connection.api.sessions.selectModel({
        sessionId: forked,
        provider: current.provider,
        model: current.model,
        ...(current.reasoningEffort !== undefined ? { reasoningEffort: current.reasoningEffort } : {}),
      })
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

/** 读子会话当前模型名（composer 模型标签用）；任何失败回退 null（默认文案）。 */
export async function readModelName(ctx: Context, sessionId: string): Promise<string | null> {
  try {
    const res = await ctx.connection.api.sessions.models({ sessionId })
    return res.result.ok ? res.result.value.current.model : null
  } catch {
    return null
  }
}
