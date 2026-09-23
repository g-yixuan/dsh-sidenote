/**
 * 「新建或聚焦一个侧边聊天 Tab」的共享编排：桥接（WI-03 划选提问
 * askInSideChat）与 /side 斜杠命令共用。
 *
 * 双腿（Workitem_04 单路化）：
 * - 直连腿（BS ≥ 0.19 ⇒ 宿主 DSH ≥ 0.1.5）：tab 注册在原生右栏，meta 在
 *   自有 metaStore，聚焦走 ISidebarRight.focus，枚举走原生快照的扁平
 *   tabs map + live registry（面板挂载自登记）+ openings 窗口期标记。
 *   单实例语义：held 规则下同 pane 同 kind 去重，「新建」折叠为聚焦既有
 *   ——草稿投递必须命中三处之一（seedDraft / openings 暂存 / metaStore
 *   的 pendingDraft），任一缺失即静默丢草稿（PR#3 前的活伤）。
 * - legacy 腿（BS < 0.19）：布局快照即注册表，openTab 同步落快照。
 *
 * 聚焦策略：同一主会话并存多个时聚焦最后一个（最近打开的）。
 * 草稿注入：目标 Tab 已 fork 且 input 机器可达 → 直接写机器草稿；
 * 否则写 meta.pendingDraft 移交面板（面板在 composer 就绪后应用并清除）。
 */
import type { Context, SidebarRightService, SidebarTab } from '../host/contracts.ts'
import {
  SIDE_TAB_TYPE,
  appendDraftText,
  collectSideTabs,
  collectTabs,
  parseSideChatMeta,
  sideTabTitle,
} from './model.ts'
import { readInputDraft, resolveSessionInput } from './composer.ts'
import { betterSidebarOf, directNativeLeg, focusNativeTab, lastLiveSideChat, liveSideChatsOf, markSideChatOpening, nativeSidebarHost, nativeTabShell, sideChatOpening } from './native.ts'
import { readSideChatMeta, sideChatMetasOf, writeSideChatMeta } from './metaStore.ts'
import { sideChatTitleOf } from './identity.ts'
import { t } from '../locales.ts'

/** 直连腿的原生右栏面（off-face 探测；无面 = 不在直连腿或面缺席降级）。 */
export function sidebarRightOf(ctx: Context): SidebarRightService | undefined {
  try {
    const face = ctx.get('sidebarRight') as SidebarRightService | undefined
    return typeof face?.openTab === 'function' ? face : undefined
  } catch {
    return undefined
  }
}

/** 直连腿判定：directNativeLeg（BS ≥0.19 或 BS 缺席）+ 原生面已就位。 */
function directLeg(ctx: Context): boolean {
  return directNativeLeg(ctx) && sidebarRightOf(ctx) !== undefined
}

/** 直连腿：向既存 tab 追加待投递草稿（面板 pendingDraft effect 消费）。 */
function appendNativePendingDraft(sessionId: string, tabId: string, draftText: string): void {
  const meta = readSideChatMeta(sessionId, tabId)
  if (meta === undefined) return
  writeSideChatMeta({ ...meta, pendingDraft: appendDraftText(meta.pendingDraft ?? '', draftText) })
}

/**
 * 从最新快照读一个 Tab（meta 合并写入前的读取面；布局即注册表）。
 * 直连腿：metaStore 是 meta 权威（原生布局无 meta 面）。
 */
export function readTab(ctx: Context, sessionId: string, tabId: string): SidebarTab | undefined {
  const direct = readSideChatMeta(sessionId, tabId)
  if (direct !== undefined) {
    const live = liveSideChatsOf(sessionId).find(entry => entry.tabId === tabId)
    return {
      id: tabId,
      type: SIDE_TAB_TYPE,
      title: live?.readTitle() ?? sideChatTitleOf(direct),
      meta: direct,
    }
  }
  const legacySnap = betterSidebarOf(ctx)?.getSnapshot()
  const tab = collectTabs(legacySnap?.state).find(candidate => candidate.id === tabId)
  return tab ?? nativeTabShell(tabId, SIDE_TAB_TYPE)
}

/**
 * 为 sessionId 新建或聚焦一个侧边聊天 Tab；draftText 给出时写入其草稿。
 * @returns false = 未能打开（调用方保持自己的流程）。
 */
export function openOrFocusSideChat(ctx: Context, sessionId: string, draftText?: string): boolean {
  if (directLeg(ctx)) return openOrFocusDirect(ctx, sessionId, draftText)
  return openOrFocusLegacy(ctx, sessionId, draftText)
}

/** 直连腿：聚焦既有（三级数据源）或铸造新开。 */
function openOrFocusDirect(ctx: Context, sessionId: string, draftText?: string): boolean {
  try {
    // 会话守卫：只操作在屏会话（openTab 本就只写在屏会话，提前拒掉省一次铸造）。
    if (ctx.sessions.list.getSnapshot().current !== sessionId) return false
    const hasDraft = draftText !== undefined && draftText !== ''

    // 1. 存活面板（已挂载登记）：草稿直达 composer/相位门。
    const live = lastLiveSideChat(sessionId)
    if (live !== undefined) {
      if (hasDraft) live.seedDraft(draftText!)
      if (!focusNativeTab(ctx, live.tabId)) sidebarRightOf(ctx)?.focus(live.tabId)
      return true
    }

    // 2. openTab→面板挂载窗口期：草稿暂存，面板注册时回放。
    const opening = sideChatOpening(sessionId)
    if (opening !== undefined) {
      if (hasDraft) opening.drafts.push(draftText!)
      return true
    }

    // 3. metaStore 里本会话已有记录：草稿先落 metaStore.pendingDraft（存活
    //    面板消费草稿的唯一通道——held 折叠时宿主虽 navigate 新 params
    //    （审查 M1 实证），但 reconcile 幂等不覆盖既有记录，params 不会被
    //    消费）。注意 metaStore 不作存活 Oracle（审查 M-3）：记录是否是
    //    孤键（tab 已不在布局）由下一步的 openTab 裁定。
    const metas = sideChatMetasOf(sessionId)
    const target = metas[metas.length - 1]
    if (target !== undefined && hasDraft) {
      appendNativePendingDraft(sessionId, target.tabId, draftText!)
    }

    // 4. openTab 即裁定：held 规则下同 kind 既有 tab 折叠聚焦（孤键/正常
    //    存活都正确）；无既存则新铸（孤键自愈——面板 reconcile 幂等接管
    //    旧记录，childId 在则走绑定恢复）。首开/新铸的初始 meta 经 params
    //    随宿主管道投递（reconcile 落 store）；聚焦既存时 params 不消费
    //    （见第 3 级），传 parentSessionId 足够。
    sidebarRightOf(ctx)!.openTab(SIDE_TAB_TYPE, {
      params: {
        parentSessionId: sessionId,
        ...(hasDraft && target === undefined ? { pendingDraft: draftText! } : {}),
      },
    })
    markSideChatOpening(sessionId)
    return true
  } catch (error) {
    console.warn('[dsh-sidenote] 打开侧边聊天失败:', error)
    return false
  }
}

/** legacy 腿：布局快照即注册表的原始路径（BS < 0.19）。 */
function openOrFocusLegacy(ctx: Context, sessionId: string, draftText?: string): boolean {
  const bs = betterSidebarOf(ctx)
  if (bs === undefined) return false
  try {
    const snapshot = bs.getSnapshot()
    // 侧边聊天活在主会话自己的侧栏状态里；目标会话不在屏上时不越权开 Tab。
    if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return false
    const existing = collectSideTabs(snapshot.state)

    // Native right sidebar (better-sidebar >= 0.19): the tab is invisible to the
    // layout snapshot, so focus the live panel and hand it the draft directly.
    const live = lastLiveSideChat(sessionId)
    if (live !== undefined) {
      if (draftText !== undefined && draftText !== '') live.seedDraft(draftText)
      // native 宿主的 activateTab 是空操作（surface.activate 只查记录存在性），
      // 聚焦走 ISidebarRight.focus 探测；面缺席（legacy）回退 activateTab。
      if (!focusNativeTab(ctx, live.tabId)) bs.activateTab(live.tabId, { sessionId })
      return true
    }

    if (existing.length > 0) {
      const target = existing[existing.length - 1]!
      if (draftText !== undefined && draftText !== '') {
        const meta = parseSideChatMeta(target.meta)
        const input = meta.childId === undefined ? null : resolveSessionInput(ctx, meta.childId)
        if (input !== null) {
          input.setDraft(appendDraftText(readInputDraft(input), draftText))
        } else {
          bs.updateTab(target.id, {
            meta: { ...meta, pendingDraft: appendDraftText(meta.pendingDraft ?? '', draftText) },
          })
        }
      }
      bs.activateTab(target.id, { sessionId })
      return true
    }

    // openTab→面板挂载窗口（native 特有）：tab 已铸但对快照与 registry 均不可见，
    // 重复触发落进 in-flight 标记（草稿暂存、注册时回放）而非再开一个
    // （双开 = 双 fork 出孤儿会话）。legacy 无此窗口（openTab 同步落快照）。
    const opening = sideChatOpening(sessionId)
    if (opening !== undefined) {
      if (draftText !== undefined && draftText !== '') opening.drafts.push(draftText)
      return true
    }

    return createSideChat(ctx, sessionId, draftText)
  } catch (error) {
    console.warn('[dsh-sidenote] 打开侧边聊天失败:', error)
    return false
  }
}

/**
 * 无条件新建一个侧边聊天 Tab（/side「新建侧边聊天」选项的语义）。
 * 直连腿（单实例期）：折叠为「聚焦既有 + 草稿正确投递」（= openOrFocus；
 * 多实例随 Delivery_02 的 multiple 放开）。
 * @returns false = 未能创建（调用方保持自己的流程）。
 */
export function createSideChat(ctx: Context, sessionId: string, draftText?: string): boolean {
  if (directLeg(ctx)) return openOrFocusDirect(ctx, sessionId, draftText)
  return createSideChatLegacy(ctx, sessionId, draftText)
}

function createSideChatLegacy(ctx: Context, sessionId: string, draftText?: string): boolean {
  const bs = betterSidebarOf(ctx)
  if (bs === undefined) return false
  try {
    const snapshot = bs.getSnapshot()
    if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return false
    // openTab 的已知静默失败面先排除（类型在设置里被禁用 = 宿主 warn 后 return，
    // 不抛错）——否则 native 分支的乐观返回会把失败报成成功。
    if (!bs.isTabEnabled(SIDE_TAB_TYPE)) return false
    // 新建：openTab 走 createTab 铸造（seed.meta 会被忽略），所以先记下既有
    // id 集，openTab 同步落状态后找出新 Tab，再把 pendingDraft 写进它的 meta。
    const before = new Set(collectTabs(snapshot.state).map(tab => tab.id))
    // Native tabs (better-sidebar >= 0.19) take meta from the seed: the minted id
    // only becomes known once the panel mounts and publishes itself.
    const seed = draftText !== undefined && draftText !== ''
      ? { type: SIDE_TAB_TYPE, meta: { pendingDraft: draftText } }
      : { type: SIDE_TAB_TYPE }
    bs.openTab(seed, { sessionId })
    const created = collectSideTabs(bs.getSnapshot().state).find(tab => !before.has(tab.id))
    if (created === undefined) {
      if (!nativeSidebarHost(ctx)) return false
      // native：tab 不进快照属预期——openTab 不抛错即视为成功；标记 in-flight
      // 窗口供并发触发去重（窗口语意见 native.ts）。
      markSideChatOpening(sessionId)
      return true
    }
    if (draftText !== undefined && draftText !== '') {
      bs.updateTab(created.id, { meta: { pendingDraft: draftText } })
    }
    return true
  } catch (error) {
    console.warn('[dsh-sidenote] 新建侧边聊天失败:', error)
    return false
  }
}

/**
 * 桥接/命令的目标预览：askInSideChat 此时若执行会落在哪个 Tab 的标题
 * （既有并存 = 最后一个；无 = 即将新建的首个标题）。用于编辑器上标明
 * 「发送至：侧边 N」。会话不在屏上/状态缺失时返回 undefined。
 */
export function sideChatTargetTitle(ctx: Context, sessionId: string): string | undefined {
  try {
    if (directLeg(ctx)) {
      if (ctx.sessions.list.getSnapshot().current !== sessionId) return undefined
      const live = lastLiveSideChat(sessionId)
      if (live !== undefined) return live.readTitle()
      const metas = sideChatMetasOf(sessionId)
      const last = metas[metas.length - 1]
      if (last !== undefined) return sideChatTitleOf(last)
      return t('tabBaseTitle')
    }
    const snapshot = betterSidebarOf(ctx)?.getSnapshot()
    if (snapshot === undefined || snapshot.sessionId !== sessionId || snapshot.state === undefined) return undefined
    const existing = collectSideTabs(snapshot.state)
    if (existing.length > 0) return existing[existing.length - 1]!.title
    // native：布局快照看不到 tab，改读 live registry（最近打开者）。
    const live = lastLiveSideChat(sessionId)
    if (live !== undefined) return live.readTitle()
    return sideTabTitle([])
  } catch {
    return undefined
  }
}

/**
 * 重开最近关闭的侧边聊天（D3 后悔药）：开 Tab + meta 预置 childId/
 * parentSessionId——面板挂载后走绑定恢复路径（不重新 fork）。
 * 会话本体必须仍 archived 在列（若被清理，面板落「会话已不存在」态——
 * 有现成错误态兜着）。
 * opts.topic（Delivery_05）：内容身份随恢复走——否则重开后 reconcile
 * 铸造的是无 topic 的新记录，身份丢一次关闭就回不来了。
 */
export function reopenSideChat(ctx: Context, sessionId: string, childId: string, opts?: { title?: string, topic?: string }): boolean {
  if (directLeg(ctx)) {
    try {
      if (ctx.sessions.list.getSnapshot().current !== sessionId) return false
      // 单实例（held）：有存活实例时重开无意义（弹层侧此时本就不列重开项）。
      if (sideChatMetasOf(sessionId).length > 0) return false
      sidebarRightOf(ctx)!.openTab(SIDE_TAB_TYPE, {
        params: {
          parentSessionId: sessionId,
          childId,
          ...(opts?.topic !== undefined ? { topic: opts.topic } : {}),
        },
      })
      markSideChatOpening(sessionId)
      return true
    } catch (error) {
      console.warn('[dsh-sidenote] 重开侧边聊天失败:', error)
      return false
    }
  }
  const bs = betterSidebarOf(ctx)
  if (bs === undefined) return false
  try {
    const snapshot = bs.getSnapshot()
    if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return false
    if (!bs.isTabEnabled(SIDE_TAB_TYPE)) return false
    // native 下同 kind 每 pane 单实例（dsh sidebar-right held 规则）：有存活
    // 实例时 openTab 必折叠为聚焦既有 tab 且 seed.meta 被丢弃——拒绝（弹层
    // 侧此时本就不列重开项，这里是双保险）。
    if (nativeSidebarHost(ctx) && liveSideChatsOf(sessionId).length > 0) return false
    const before = new Set(collectTabs(snapshot.state).map(tab => tab.id))
    // native（>= 0.19）：seed.meta 携带恢复信息（native 面采纳 seed.meta；
    // 面板挂载即走绑定恢复路径）。legacy 的 createTab 铸造忽略 seed.meta，
    // 落快照后补写。topic 在时标题直接以内容身份铸造，不走编号。
    const meta = { childId, parentSessionId: sessionId, ...(opts?.topic !== undefined ? { topic: opts.topic } : {}) }
    const title = opts?.title ?? (opts?.topic !== undefined ? sideChatTitleOf({ number: 1, topic: opts.topic }) : undefined)
    bs.openTab({ type: SIDE_TAB_TYPE, ...(title !== undefined ? { title } : {}), meta }, { sessionId })
    const created = collectSideTabs(bs.getSnapshot().state).find(tab => !before.has(tab.id))
    if (created === undefined) {
      if (!nativeSidebarHost(ctx)) return false
      markSideChatOpening(sessionId)
      return true
    }
    bs.updateTab(created.id, {
      ...(title !== undefined ? { title } : {}),
      meta,
    })
    return true
  } catch (error) {
    console.warn('[dsh-sidenote] 重开侧边聊天失败:', error)
    return false
  }
}
