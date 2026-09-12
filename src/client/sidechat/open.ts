/**
 * 「新建或聚焦一个侧边聊天 Tab」的共享编排：桥接（WI-03 划选提问
 * askInSideChat）与 /side 斜杠命令共用。
 *
 * 聚焦策略：同一主会话并存多个时聚焦最后一个（最近打开的）。
 * 草稿注入：目标 Tab 已 fork 且 input 机器可达 → 直接写机器草稿；
 * 否则写 meta.pendingDraft 移交面板（面板在 composer 就绪后应用并清除）。
 */
import type { Context, SidebarTab } from '../host/contracts.ts'
import {
  SIDE_TAB_TYPE,
  appendDraftText,
  collectSideTabs,
  collectTabs,
  parseSideChatMeta,
  sideTabTitle,
} from './model.ts'
import { readInputDraft, resolveSessionInput } from './composer.ts'
import { focusNativeTab, lastLiveSideChat, liveSideChatsOf, markSideChatOpening, nativeSidebarHost, nativeTabShell, sideChatOpening } from './native.ts'

/**
 * 从最新快照读一个 Tab（meta 合并写入前的读取面；布局即注册表）。
 * better-sidebar >= 0.19: the open tab lives in the native right sidebar, not
 * in the layout snapshot — fall back to the live-panel registry.
 */
export function readTab(ctx: Context, tabId: string): SidebarTab | undefined {
  const tab = collectTabs(ctx.betterSidebar.getSnapshot().state).find(candidate => candidate.id === tabId)
  return tab ?? nativeTabShell(tabId, SIDE_TAB_TYPE)
}

/**
 * 为 sessionId 新建或聚焦一个侧边聊天 Tab；draftText 给出时写入其草稿。
 * @returns false = 未能打开（调用方保持自己的流程）。
 */
export function openOrFocusSideChat(ctx: Context, sessionId: string, draftText?: string): boolean {
  try {
    const snapshot = ctx.betterSidebar.getSnapshot()
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
      if (!focusNativeTab(ctx, live.tabId)) ctx.betterSidebar.activateTab(live.tabId, { sessionId })
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
          ctx.betterSidebar.updateTab(target.id, {
            meta: { ...meta, pendingDraft: appendDraftText(meta.pendingDraft ?? '', draftText) },
          })
        }
      }
      ctx.betterSidebar.activateTab(target.id, { sessionId })
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
 * 无条件新建一个侧边聊天 Tab（/side「新建侧边聊天」选项的语义——既有实例
 * 在弹层里另有聚焦项，「新建」必须真的新建，否则标签与行为不符）。
 * @returns false = 未能创建（调用方保持自己的流程）。
 */
export function createSideChat(ctx: Context, sessionId: string, draftText?: string): boolean {
  try {
    const snapshot = ctx.betterSidebar.getSnapshot()
    if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return false
    // openTab 的已知静默失败面先排除（类型在设置里被禁用 = 宿主 warn 后 return，
    // 不抛错）——否则 native 分支的乐观返回会把失败报成成功。
    if (!ctx.betterSidebar.isTabEnabled(SIDE_TAB_TYPE)) return false
    // 新建：openTab 走 createTab 铸造（seed.meta 会被忽略），所以先记下既有
    // id 集，openTab 同步落状态后找出新 Tab，再把 pendingDraft 写进它的 meta。
    const before = new Set(collectTabs(snapshot.state).map(tab => tab.id))
    // Native tabs (better-sidebar >= 0.19) take meta from the seed: the minted id
    // only becomes known once the panel mounts and publishes itself.
    const seed = draftText !== undefined && draftText !== ''
      ? { type: SIDE_TAB_TYPE, meta: { pendingDraft: draftText } }
      : { type: SIDE_TAB_TYPE }
    ctx.betterSidebar.openTab(seed, { sessionId })
    const created = collectSideTabs(ctx.betterSidebar.getSnapshot().state).find(tab => !before.has(tab.id))
    if (created === undefined) {
      if (!nativeSidebarHost(ctx)) return false
      // native：tab 不进快照属预期——openTab 不抛错即视为成功；标记 in-flight
      // 窗口供并发触发去重（窗口语意见 native.ts）。
      markSideChatOpening(sessionId)
      return true
    }
    if (draftText !== undefined && draftText !== '') {
      ctx.betterSidebar.updateTab(created.id, { meta: { pendingDraft: draftText } })
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
    const snapshot = ctx.betterSidebar.getSnapshot()
    if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return undefined
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
 */
export function reopenSideChat(ctx: Context, sessionId: string, childId: string, title?: string): boolean {
  try {
    const snapshot = ctx.betterSidebar.getSnapshot()
    if (snapshot.sessionId !== sessionId || snapshot.state === undefined) return false
    if (!ctx.betterSidebar.isTabEnabled(SIDE_TAB_TYPE)) return false
    // native 下同 kind 每 pane 单实例（dsh sidebar-right held 规则）：有存活
    // 实例时 openTab 必折叠为聚焦既有 tab 且 seed.meta 被丢弃——拒绝（弹层
    // 侧此时本就不列重开项，这里是双保险）。
    if (nativeSidebarHost(ctx) && liveSideChatsOf(sessionId).length > 0) return false
    const before = new Set(collectTabs(snapshot.state).map(tab => tab.id))
    // native（>= 0.19）：seed.meta 携带恢复信息（native 面采纳 seed.meta；
    // 面板挂载即走绑定恢复路径）。legacy 的 createTab 铸造忽略 seed.meta，
    // 落快照后补写。
    const meta = { childId, parentSessionId: sessionId }
    ctx.betterSidebar.openTab({ type: SIDE_TAB_TYPE, ...(title !== undefined ? { title } : {}), meta }, { sessionId })
    const created = collectSideTabs(ctx.betterSidebar.getSnapshot().state).find(tab => !before.has(tab.id))
    if (created === undefined) {
      if (!nativeSidebarHost(ctx)) return false
      markSideChatOpening(sessionId)
      return true
    }
    ctx.betterSidebar.updateTab(created.id, {
      ...(title !== undefined ? { title } : {}),
      meta,
    })
    return true
  } catch (error) {
    console.warn('[dsh-sidenote] 重开侧边聊天失败:', error)
    return false
  }
}
