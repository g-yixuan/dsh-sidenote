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
import { readTab, sidebarRightOf } from './open.ts'
import { betterSidebarOf, directNativeLeg, rootContext } from './native.ts'
import { readSideChatMeta, writeSideChatMeta } from './metaStore.ts'
import { sideChatTitleOf } from './identity.ts'
import { sessionVisibilityOf } from '../host/sessionVisibility.ts'
import { openSession } from '../host/navigation.ts'
import { resolveInput, inputAttachmentIds } from '../host/input.ts'
import { clearForkQueue } from '../host/submission.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import { t } from '../locales.ts'
export { openSession } from '../host/navigation.ts'

import { readModelSelection, writeModelSelection } from '../host/models.ts'
export { projectedModelSelection, remoteSessionFace, readModelSelection, writeModelSelection, readModelName, listModels, switchModel } from '../host/models.ts'

import { chatSourceOf, inheritedBoundarySource, retainSession, unfinishedCompactionCut } from '../host/chat.ts'
export { chatSourceOf, retainSession } from '../host/chat.ts'

/** 主线运行或等待交互时，首条侧聊消息补充 fork 切点之后的进展。 */
export function sessionBusyOf(ctx: Context, sessionId: string): boolean {
  try {
    const binding = ctx.sessions.binding(sessionId)
    const snap = binding?.session?.getSnapshot?.() as { running?: boolean; pending?: readonly unknown[] } | null
    if (snap?.running === true) return true
    if ((snap?.pending?.length ?? 0) > 0) return true
    const legacy = chatSourceOf(ctx, binding)?.getLegacy() as { pending?: readonly unknown[] } | null
    return (legacy?.pending?.length ?? 0) > 0
  } catch {
    return false
  }
}

/** fork-unavailable 判定（主线没有任何已完成 turn）。 */
function isForkUnavailable(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /fork-unavailable|no completed turn/.test(text)
}

/**
 * 零完成轮兜底：主线首轮在飞时 fork 不可用（fork-unavailable）——退化为
 * create 一个纯快照会话（无继承历史，全部上下文由 WI-02 的进展快照供给）。
 * sessions.create 是 off-face（client 契约面只有 fork/binding/scope/open），
 * 探测不到就抛错（面板转 fork-error 态）。
 */
async function createSideSession(ctx: Context, parentSessionId: string): Promise<string> {
  const svc = ctx.sessions as unknown as { create?: (opts?: { cwd?: string }) => Promise<string> }
  if (typeof svc.create !== 'function') {
    throw new Error('宿主 sessions.create 面缺席，无法创建快照会话')
  }
  // 跟随主会话 cwd（列表投影的 summary 带），缺席则宿主默认工作区。
  let cwd: string | undefined
  try {
    const summary = ctx.sessions.list.getSnapshot().byId?.[parentSessionId] as { cwd?: string } | undefined
    cwd = typeof summary?.cwd === 'string' ? summary.cwd : undefined
  } catch {
    // 缺席不阻断。
  }
  return svc.create(cwd === undefined ? {} : { cwd })
}

/**
 * 首开编排：暂缓新增列表行 → fork → 登记隐藏身份/meta →
 * 旧宿主归档（best-effort）→ 模型跟随主会话（best-effort）。
 * fork 失败抛错（面板组件转错误态）；后两步失败只告警不阻断。
 *
 * 主线在飞时，首条侧边消息补充切点之后的进展快照；
 * 主线零完成轮（fork-unavailable）退化为 create 纯快照会话（snapshotOnly）。
 * @returns fork/创建出的子会话 id。
 */
export async function forkAndRegister(ctx: Context, parentSessionId: string, tabId: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted === true) throw new DOMException('side chat fork aborted', 'AbortError')
  const compactionCut = unfinishedCompactionCut(ctx.sessions.binding(parentSessionId)?.session)
  const busy = sessionBusyOf(ctx, parentSessionId) || compactionCut !== undefined
  let boundarySeq: number | undefined
  // The slot-provided context a panel receives has a narrower inject list than the
  // plugin root context, so host calls go through the root context (see native.ts).
  const owner = rootContext(ctx)

  let forked: string
  let snapshotOnly = false
  const visibility = sessionVisibilityOf(owner)
  const finishVisibility = visibility.begin(owner.sessions.list.getSnapshot())
  try {
    if (!busy) {
      forked = await ctx.sessions.fork({ sessionId: parentSessionId })
    } else {
      try {
        forked = await ctx.sessions.fork({ sessionId: parentSessionId, ...(compactionCut === undefined ? {} : { atSeq: compactionCut }) })
      } catch (error) {
        if (!isForkUnavailable(error)) throw error
        forked = await createSideSession(owner, parentSessionId)
        snapshotOnly = true
      }
    }
    // Register identity before releasing provisional new rows, including create fallback.
    visibility.hide(forked)
    // The host's default cut also includes standalone compactions after turn/end.
    // Read the resulting child marker; neither parent message seqs nor a cached
    // turn/end can establish this boundary without a race.
    const reference = retainSession(ctx, forked)
    try {
      await reference?.ready
      const binding = reference?.binding ?? ctx.sessions.binding(forked)
      await openSessionWindow(binding?.session)
      boundarySeq = inheritedBoundarySource(binding?.session)?.getSnapshot()
      if (binding && !snapshotOnly) await clearForkQueue(binding)
    } finally { reference?.release() }
  } finally {
    finishVisibility()
  }
  // meta 先行：fork resolve 后立即登记 childId（会话切换导致组件卸载时
  // updateTab 找不到 tab 也只是 no-op——否则 Tab 永远停在 forking 且下次
  // 挂载重复 fork 出孤儿会话）。
  updateTabMeta(ctx, parentSessionId, tabId, (current) => ({
    ...current,
    childId: forked,
    parentSessionId,
    boundarySeq: snapshotOnly ? -1 : boundarySeq,
    ...(busy ? { forkedMidTurn: true } : {}),
    ...(snapshotOnly ? { snapshotOnly: true } : {}),
  }))
  // 归档隐藏出会话列表——但 0.1.7 起 ArchivedSessionGate 把「已归档」当作
  // 拒跑模型步的硬闸门（agent/pre-step reject → turn/end blocked，实测侧边
  // 消息 200 后 30ms 内被 block）。判据：workspace 面有 unarchiveSession
  // （0.1.7 才新增）。有闸门的宿主由列表投影隐藏，不改变归档状态。
  if (typeof owner.workspaces.unarchiveSession !== 'function') {
    // 归档失败时仍有列表投影；投影缺席则保留可见，不阻断面板。
    try {
      await owner.workspaces.archiveSession(forked)
    } catch (error) {
      console.warn('[dsh-sidenote] 归档侧边会话失败:', error)
    }
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

/**
 * Tab meta 读-改-写。双腿：直连原生腿的 meta 在自有 metaStore（原生无
 * updateTab 面，布局 memory-only）；legacy 腿在布局快照 + betterSidebar.updateTab。
 * 分腿判据统一为 directNativeLeg（对抗性审查 m1：判据单点化——metaStore
 * 有无记录不能再当判据，否则记录缺失时 childId 登记会静默落到 no-op 的
 * legacy 面）。直连腿记录缺失 = 异常态（reconcile 应先已建）：warn 并 no-op。
 */
export function updateTabMeta(ctx: Context, sessionId: string, tabId: string, mutate: (meta: SideChatMeta) => SideChatMeta): void {
  if (directNativeLeg(ctx)) {
    const direct = readSideChatMeta(sessionId, tabId)
    if (direct === undefined) {
      console.warn('[dsh-sidenote] meta 记录缺失（reconcile 应先已建），本次 meta 写入跳过:', tabId)
      return
    }
    const next = mutate(parseSideChatMeta(direct))
    // 缺键即删（clearPendingDraft 语义）：JSON.stringify 丢弃 undefined 键。
    writeSideChatMeta({
      tabId,
      sessionId: direct.sessionId,
      ...(next.childId !== undefined ? { childId: next.childId } : {}),
      ...(next.parentSessionId !== undefined ? { parentSessionId: next.parentSessionId } : {}),
      ...(next.pendingDraft !== undefined ? { pendingDraft: next.pendingDraft } : {}),
      ...(next.boundarySeq !== undefined ? { boundarySeq: next.boundarySeq } : {}),
      ...(next.forkedMidTurn === true ? { forkedMidTurn: true } : {}),
      ...(next.snapshotOnly === true ? { snapshotOnly: true } : {}),
      ...(next.topic !== undefined ? { topic: next.topic } : {}),
      number: direct.number,
      createdAt: direct.createdAt,
      ...(direct.runId !== undefined ? { runId: direct.runId } : {}),
    })
    return
  }
  const bs = betterSidebarOf(ctx)
  if (bs === undefined) return
  const current = parseSideChatMeta(readTab(ctx, sessionId, tabId)?.meta)
  bs.updateTab(tabId, { meta: mutate(current) })
}

/**
 * 写入内容身份（Delivery_05）：meta 双腿写 + legacy 腿补标题 patch
 * （native 芯片标题槽订阅 metaStore，meta 落库即免费响应；legacy 标题是
 * 布局快照里的静态字段，必须显式 patch；topic 在时编号不参与标题，
 * 故 legacy 侧无需反推编号）。sticky 守卫沉在 mutate 里（同帧连发两次
 * submit 时面板侧 ref 守卫有相位差，审查 L2）。
 */
export function setSideChatTopic(ctx: Context, sessionId: string, tabId: string, topic: string): void {
  updateTabMeta(ctx, sessionId, tabId, (cur) => (cur.topic !== undefined ? cur : { ...cur, topic }))
  if (directNativeLeg(ctx)) return
  // legacy 标题 patch 必须用生效的 topic（sticky 守卫可能保留了旧值）。
  const effective = parseSideChatMeta(readTab(ctx, sessionId, tabId)?.meta).topic ?? topic
  betterSidebarOf(ctx)?.updateTab(tabId, { title: sideChatTitleOf({ number: 1, topic: effective }) })
}

/** 关闭侧聊 tab：直连腿走 ISidebarRight.close，legacy 走 betterSidebar.closeTab。 */
export function closeSideTab(ctx: Context, tabId: string, sessionId: string): void {
  if (directNativeLeg(ctx)) {
    const face = sidebarRightOf(ctx)
    if (face !== undefined) {
      face.close(tabId)
      return
    }
  }
  betterSidebarOf(ctx)?.closeTab(tabId, { sessionId })
}

/** A saved copy is a regular session; close the source tab before changing views. */
export async function saveSideChatSession(ctx: Context, childId: string, tabId: string, parentSessionId: string, annotations?: Pick<AnnotationStore, 'countActive'>): Promise<void> {
  const session = rootContext(ctx).sessions.binding(childId)?.session
  const machine = resolveInput(rootContext(ctx), childId)
  const input = machine?.state.getSnapshot()
  if (session?.getSnapshot().running === true || (input?.queue?.length ?? 0) > 0 || (input !== undefined && input.phase !== 'plain')) throw new Error(t('promoteBusy'))
  if (input?.draft.trim() || (machine !== undefined && inputAttachmentIds(machine).length > 0) || (annotations?.countActive(childId) ?? 0) > 0) throw new Error(t('promoteDraftBusy'))
  const promoted = await rootContext(ctx).sessions.fork({ sessionId: childId, increaseTitle: true })
  closeSideTab(ctx, tabId, parentSessionId)
  openSession(ctx, promoted)
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
 * 0.1.7 自愈：旧版本插件把侧边子会话归档隐藏，ArchivedSessionGate 会拒跑它
 * 的模型步（turn/end blocked）。面板挂载时对 childId 幂等 unarchive；
 * 旧宿主无此 API 时 no-op。
 */
export function unarchiveSideSession(ctx: Context, sessionId: string | undefined): void {
  if (sessionId === undefined) return
  const unarchive = ctx.workspaces.unarchiveSession
  if (typeof unarchive !== 'function') return
  void unarchive.call(ctx.workspaces, sessionId).catch(() => {
    // 未归档/已恢复 → 静默；其他失败不阻断面板。
  })
}

/**
 * 打开非 staged 会话的事件窗口（off-face：open() 在 concrete Session 上是
 * public 且幂等，但不在 SessionFace 契约上——契约面只有 staged 会话会被
 * 运行时自动 open）。feature-check + 吞错，运行时若移除则降级为只发不收。
 */
export async function openSessionWindow(session: SessionFace | undefined): Promise<void> {
  const openable = session as unknown as { open?: () => Promise<void> } | undefined
  if (typeof openable?.open !== 'function') return
  await openable.open().catch((error: unknown) => {
    console.warn('[dsh-sidenote] 会话窗口打开失败:', error)
  })
}
