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
import { readTab, sidebarRightOf } from './open.ts'
import { betterSidebarOf, directNativeLeg, rootContext } from './native.ts'
import { readSideChatMeta, writeSideChatMeta } from './metaStore.ts'
import { sideChatTitleOf } from './identity.ts'
import { contentTextOf } from '../chat/transcript.ts'
import { SNAPSHOT_BLOCK_MARK } from './snapshot.ts'

/**
 * 主线忙碌判定（busy-fork 路由）。2026-09-22 实证的宿主 fork 语义缺口：fork
 * 一个 turn 在飞的会话，会把在飞消息以「未认领的 inbox splice」形态遗传
 * 给子会话——子会话 boot 后把它当成自己的首个任务执行，用户真正发的侧边
 * 消息则排进不可见队列（用户视角 = 「发不了」+「主线最后一条消息被抄到
 * 侧边」）。busy 时改走 busy-fork 路径（fork 后监护中和遗传 turn，见
 * armInheritedTurnPurge）。
 *
 * busy = running（Session 快照顶层，0.1.1/0.1.2/0.1.5 同在）或 pending
 * 非空（审批/提问挂起：0.1.1 在 Session 快照顶层，0.1.2 起在
 * uiConversation.chat 的 legacy 切片——双面都读，同面板 R8 链）。
 * 探测失败一律按「空闲」放行（fork 错误面兜底），绝不因读不到状态而卡死。
 */
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

// ── busy-fork 遗传 turn 监护（Delivery_04） ─────────────────────────────────

/**
 * 监护中的子会话登记处：完成通知模块（notify.ts）据此抑制误报——遗传 turn
 * 被 cancel 的 running 翻转不是「侧边回复完成」。
 */
const purgingChildren = new Set<string>()

/** 该子会话当前是否处于遗传 turn 监护/清除窗口。 */
export function isPurgingInheritedTurn(childId: string): boolean {
  return purgingChildren.has(childId)
}

/** 读父会话当前最大节点 seq（折叠边界；读不到不阻断）。 */
function readMaxNodeSeq(ctx: Context, sessionId: string): number | undefined {
  try {
    const source = chatSourceOf(ctx, ctx.sessions.binding(sessionId))
    const snap = source?.getLegacy()
    let max = -1
    for (const node of snap?.nodes ?? []) {
      const seq = (node as { seq?: unknown }).seq
      if (typeof seq === 'number' && seq > max) max = seq
    }
    return max >= 0 ? max : undefined
  } catch {
    return undefined
  }
}

/**
 * 读 fork 折叠边界 = 父会话「在飞 turn 之前」的最大节点 seq。
 * busy 时在飞 turn 的节点（最后一条 user/steering 起）不随 fork 继承，必须
 * 排除——否则边界会越过遗传消息在子会话里的 seq，监护把泄漏误判成「继承
 * 内容」而漏 cancel（2026-09-23 真机实证：sleep 240 在子会话里跑起来了）。
 */
function readInheritedBoundary(ctx: Context, sessionId: string, busy: boolean): number | undefined {
  if (!busy) return readMaxNodeSeq(ctx, sessionId)
  try {
    const source = chatSourceOf(ctx, ctx.sessions.binding(sessionId))
    const nodes = source?.getLegacy()?.nodes ?? []
    // 在飞 turn 起点 = 最后一条 user/steering 节点；排除它及之后的节点。
    let endExclusive = nodes.length
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const kind = (nodes[i] as { kind?: unknown })?.kind
      if (kind === 'user' || kind === 'steering') { endExclusive = i; break }
    }
    let max = -1
    for (const node of nodes.slice(0, endExclusive)) {
      const seq = (node as { seq?: unknown }).seq
      if (typeof seq === 'number' && seq > max) max = seq
    }
    return max >= 0 ? max : undefined
  } catch {
    return undefined
  }
}

/** fork-unavailable 判定（主线没有任何已完成 turn）。 */
function isForkUnavailable(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /fork-unavailable|no completed turn/.test(text)
}

/**
 * 读主线在飞 turn 的任务消息前缀（监护的判别依据）：父投影最后一个
 * user/steering 节点即它。截 200 字符入 meta（够判别即可，meta 走
 * localStorage，不扛全文）。读不到 = undefined（监护退化为纯时序判别）。
 */
function readInflightUserPrefix(ctx: Context, parentSessionId: string): string | undefined {
  try {
    const source = chatSourceOf(ctx, ctx.sessions.binding(parentSessionId))
    const nodes = source?.getLegacy()?.nodes ?? []
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const n = nodes[i] as { kind?: unknown; content?: unknown }
      if (n?.kind === 'user' || n?.kind === 'steering') {
        const text = contentTextOf(n.content)
        if (text !== '') return text.slice(0, 200)
      }
    }
  } catch {
    // 读不到不阻断。
  }
  return undefined
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
 * 遗传 turn 监护（busy fork 的核心中和手段）：busy fork 的子会话日志带着
 * 主线在飞消息的未认领 inbox insert（宿主 fork cut 缺陷），boot 后会被认领
 * 执行。子会话 fork 后是休眠的（实测不 open 不 prompt 不跑）。
 *
 * 信号面（实证教训，勿回退）：Session 控制快照的 running 位由管理器的
 * 列表/活动通道驱动，**非在屏会话不实时翻牌**——watch 它永远等不到 true。
 * 可靠信号是 chat 投影（openSessionWindow 打开的事件窗驱动）：泄漏消息只在
 * 被认领（= 遗传 turn 开跑）后才落成 user 节点——**该节点在子会话投影中
 * 出现即 turn 已开跑**，此刻 cancel 恰落在首个 LLM 响应窗口内（≥1s），
 * 工具来不及执行。
 *
 * 判别（双门，防误伤）：先过 seq 门——继承节点的 seq 与父会话原值一致
 * （fork 前缀逐字拷贝），只有 seq > forkBoundarySeq 的用户节点才是 fork 后
 * 新增的（继承历史里的用户消息不参与判别）；再过文本门——expectedPrefix
 * 在场时节点的文本须命中 fork 时刻记下的在飞消息前缀，未命中（宿主已修好
 * cut 缺陷/用户自己的首个侧边消息）即解除，绝不误 cancel。前缀缺席
 * （读取失败）退化为纯 seq 门判别。
 *
 * 监护一次性：settle（cancel 完成/判别未命中/用户自己的首条消息带快照前缀）
 * 后解除并把 meta 标 inheritedPurged——面板重挂载（关 tab 重开）靠该标记
 * 跳过重复监护。cancel 后推进折叠边界覆盖 aborted turn（界面无感）。
 * **不设静置超时**：子会话休眠到用户首条消息才认领 inbox（真机实证），
 * 泄漏 turn 可能在任意晚的时刻开跑——超时撤防等于把洞留给慢用户。
 * 幂等：同一 childId 重复调用只监护一次（purgingChildren 守卫）。
 */
export function armInheritedTurnPurge(ctx: Context, childId: string, parentSessionId: string, tabId: string, expectedPrefix?: string, forkBoundarySeq?: number): void {
  if (purgingChildren.has(childId)) return
  purgingChildren.add(childId)
  let settled = false
  const offs: Array<() => void> = []
  const markPurged = (): void => {
    updateTabMeta(ctx, parentSessionId, tabId, (cur) => ({ ...cur, inheritedPurged: true }))
  }
  const disarm = (): void => {
    if (settled) return
    settled = true
    for (const off of offs) off()
    purgingChildren.delete(childId)
    markPurged()
  }
  /**
   * 子会话投影里「fork 后新增」的用户消息文本（无 = ''）：seq ≤ fork 边界的
   * 节点全是继承历史（seq 随 fork 前缀逐字拷贝），直接排除。
   */
  const freshUserText = (): string => {
    try {
      const source = chatSourceOf(ctx, ctx.sessions.binding(childId))
      const nodes = source?.getLegacy()?.nodes ?? []
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const n = nodes[i] as { kind?: unknown; content?: unknown; seq?: unknown }
        if (n?.kind !== 'user' && n?.kind !== 'steering') continue
        // 撞到继承节点即停——它之后的才是 fork 后新增，而它在列表尾部方向
        // 是先遇到的继承内容（新增内容 seq 恒大于边界，倒序首个继承节点
        // 说明没有新增）。
        if (forkBoundarySeq !== undefined && typeof n.seq === 'number' && n.seq <= forkBoundarySeq) return ''
        return contentTextOf(n.content)
      }
    } catch {
      // 读不到按未命中处理（保守不 cancel）。
    }
    return ''
  }
  try {
    const binding = ctx.sessions.binding(childId)
    const session = binding?.session
    const cancelFace = session as unknown as { cancel?: () => Promise<unknown> } | undefined
    const chat = binding === undefined ? undefined : chatSourceOf(ctx, binding)
    if (session === undefined || typeof cancelFace?.cancel !== 'function' || chat === undefined) {
      // cancel/chat 面缺席（老宿主）→ 降级：监护不做，行为退回修复前（告警留痕）。
      console.warn('[dsh-sidenote] 子会话 cancel/chat 面缺席，遗传 turn 监护未启用:', childId, 'session:', session !== undefined, 'chat:', chat !== undefined)
      purgingChildren.delete(childId)
      return
    }

    // 泄漏消息被认领（落成 fork 后的新 user 节点）= 遗传 turn 开跑 → cancel。
    // cancel 会中止在飞 turn 并把用户排在后面的消息留在 pending（宿主语义
    // 不再自动续跑）——由 reconcileChildQueueAfterCancel 负责把用户的真实
    // 消息捞出来重投。updateQueue 剔除对休眠子会话不可行（队列要等 agent
    // 暖机才物化，物化即认领——真机实证），只能在认领后拦截。
    const cancelChild = cancelFace.cancel
    offs.push(chat.subscribe(() => {
      if (settled) return
      const text = freshUserText()
      if (text === '') return
      // 用户自己的首条侧边消息带进展快照前缀——绝不误伤（无前缀可判的
      // 纯时序形态下，这是区分「遗传 turn」和「用户首个 turn」的关键护栏）。
      if (text.startsWith(SNAPSHOT_BLOCK_MARK)) { disarm(); return }
      if (expectedPrefix !== undefined && !text.startsWith(expectedPrefix)) { disarm(); return }
      settled = true
      for (const off of offs) off()
      void cancelChild.call(session)
        .catch((error: unknown) => console.warn('[dsh-sidenote] 遗传 turn 取消失败:', error))
        .finally(() => {
          purgingChildren.delete(childId)
          markPurged()
          advanceBoundaryPastTail(ctx, parentSessionId, tabId, childId)
          reconcileChildQueueAfterCancel(ctx, childId, expectedPrefix)
        })
    }))
  } catch {
    purgingChildren.delete(childId)
  }
}

/**
 * cancel 后队列和解（真机实证：宿主 cancel 保留 inbox 但不自动续跑，且
 * 休眠子会话的队列要等 agent 暖机才物化——认领前剔除对休眠子会话不可行）。
 * 等 turn 落定（running 翻 false）后读队列：
 * - 命中在飞前缀的项 = 没跑赢 claim 的泄漏/主线积压 → remove；
 * - 带快照前缀的项 = 用户的真实侧边消息 → remove + 原样重投（内容含快照
 *   前缀，remove 先行保证不重影），让它真正跑起来。
 * 两者皆无（主线积压、用户的快手第二条）→ 留在队列里不动（保守不删用户文字）。
 */
function reconcileChildQueueAfterCancel(ctx: Context, childId: string, expectedPrefix: string | undefined): void {
  let attempts = 0
  const tick = (): void => {
    attempts += 1
    try {
      const session = ctx.sessions.binding(childId)?.session as {
        getSnapshot?: () => unknown
        updateQueue?: (itemId: string, action: { kind: 'remove' }) => Promise<unknown>
        prompt?: (content: unknown, mode: 'queue' | 'steer') => Promise<unknown>
      } | undefined
      const snap = session?.getSnapshot?.() as { running?: boolean; queue?: ReadonlyArray<{ id?: unknown; text?: unknown; content?: unknown }> } | null
      if (session === undefined || snap === undefined || snap === null || typeof session.updateQueue !== 'function' || typeof session.prompt !== 'function') return
      if (snap.running === true) {
        if (attempts < 8) setTimeout(tick, 400)
        return
      }
      const updateQueue = session.updateQueue.bind(session)
      const prompt = session.prompt.bind(session)
      for (const item of snap.queue ?? []) {
        if (typeof item?.id !== 'string') continue
        const text = typeof item.text === 'string' ? item.text : contentTextOf(item.content)
        const isLeak = expectedPrefix !== undefined && text.startsWith(expectedPrefix)
        const isUserReal = text.startsWith(SNAPSHOT_BLOCK_MARK)
        if (!isLeak && !isUserReal) continue
        const itemId = item.id
        const content = item.content
        void updateQueue(itemId, { kind: 'remove' })
          .then(() => {
            if (!isUserReal) return undefined
            return prompt(content, 'queue')
          })
          .catch((error: unknown) => console.warn('[dsh-sidenote] 取消后队列和解失败:', error))
      }
    } catch {
      // 面缺席不阻断。
    }
  }
  setTimeout(tick, 300)
}

/**
 * cancel 后把折叠边界推进到子会话内容尾（覆盖 aborted turn）。中断 turn 的
 * 冻结节点带小数 seq（宿主 fork 文档实证），故 boundarySeq 允许非整数。
 * 等 running 翻 false 且节点落定再读；最多重试 ~3s，失败不阻断（aborted
 * turn 会短暂可见，属可接受降级）。
 */
function advanceBoundaryPastTail(ctx: Context, parentSessionId: string, tabId: string, childId: string): void {
  let attempts = 0
  const tick = (): void => {
    attempts += 1
    try {
      const binding = ctx.sessions.binding(childId)
      const running = (binding?.session.getSnapshot() as { running?: boolean } | null)?.running === true
      const max = running ? undefined : readMaxNodeSeq(ctx, childId)
      if (max !== undefined) {
        updateTabMeta(ctx, parentSessionId, tabId, (cur) => ({
          ...cur,
          boundarySeq: Math.max(cur.boundarySeq ?? -1, max),
        }))
        return
      }
    } catch {
      // 重试。
    }
    if (attempts < 8) setTimeout(tick, 400)
  }
  setTimeout(tick, 300)
}

/**
 * 首开编排：fork（全量历史快照）→ 登记 meta（先行，绝不丢登记）→
 * 归档隐藏出会话列表（best-effort）→ 模型跟随主会话（best-effort）。
 * fork 失败抛错（面板组件转错误态）；后两步失败只告警不阻断。
 *
 * 主线 turn 在飞（busy）时走 busy-fork（Delivery_04）：立即 fork + 遗传
 * turn 监护 + meta 打 forkedMidTurn 标记（首条侧边消息拼进展快照）；
 * 主线零完成轮（fork-unavailable）退化为 create 纯快照会话（snapshotOnly）。
 * @returns fork/创建出的子会话 id。
 */
export async function forkAndRegister(ctx: Context, parentSessionId: string, tabId: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted === true) throw new DOMException('side chat fork aborted', 'AbortError')
  const busy = sessionBusyOf(ctx, parentSessionId)
  // D1 折叠边界：fork 前读父会话「在飞 turn 之前」的最大节点 seq（busy 时
  // 排除在飞 turn 的节点——它们不随 fork 继承，见 readInheritedBoundary 注）。
  const boundarySeq = readInheritedBoundary(ctx, parentSessionId, busy)
  // 监护判别依据：fork 前抓主线在飞消息前缀（busy 才有意义）。
  const leakedPromptPrefix = busy ? readInflightUserPrefix(ctx, parentSessionId) : undefined
  // The slot-provided context a panel receives has a narrower inject list than the
  // plugin root context, so host calls go through the root context (see native.ts).
  const owner = rootContext(ctx)

  let forked: string
  let snapshotOnly = false
  if (!busy) {
    forked = await ctx.sessions.fork({ sessionId: parentSessionId })
  } else {
    try {
      forked = await ctx.sessions.fork({ sessionId: parentSessionId })
    } catch (error) {
      if (!isForkUnavailable(error)) throw error
      forked = await createSideSession(owner, parentSessionId)
      snapshotOnly = true
    }
    // 监护必须在 meta 登记（触发面板开窗 → 子会话 boot）之前就位——
    // 「open 前订阅」是把 cancel 窗口压到 LLM 首响应之前的关键。
    if (!snapshotOnly) armInheritedTurnPurge(ctx, forked, parentSessionId, tabId, leakedPromptPrefix, boundarySeq)
  }
  // meta 先行：fork resolve 后立即登记 childId（会话切换导致组件卸载时
  // updateTab 找不到 tab 也只是 no-op——否则 Tab 永远停在 forking 且下次
  // 挂载重复 fork 出孤儿会话）。
  updateTabMeta(ctx, parentSessionId, tabId, (current) => ({
    ...current,
    childId: forked,
    parentSessionId,
    ...(boundarySeq !== undefined ? { boundarySeq } : {}),
    ...(busy ? { forkedMidTurn: true } : {}),
    ...(snapshotOnly ? { snapshotOnly: true } : {}),
    ...(leakedPromptPrefix !== undefined ? { leakedPromptPrefix } : {}),
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
      ...(next.leakedPromptPrefix !== undefined ? { leakedPromptPrefix: next.leakedPromptPrefix } : {}),
      ...(next.inheritedPurged === true ? { inheritedPurged: true } : {}),
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
