/**
 * 「新建或聚焦一个侧边聊天 Tab」的共享编排：桥接（WI-03 划选提问
 * askInSideChat）与 /side 斜杠命令共用。
 *
 * 聚焦策略：同一主会话并存多个时聚焦最后一个（最近打开的）。
 * 草稿注入：目标 Tab 已 fork 且 input 机器可达 → 直接写机器草稿；
 * 否则写 meta.pendingDraft 移交面板（面板在 composer 就绪后应用并清除）。
 */
import type { Context, SidebarTab } from '../../context-types.ts'
import {
  SIDE_TAB_TYPE,
  appendDraftText,
  collectSideTabs,
  collectTabs,
  parseSideChatMeta,
} from './model.ts'
import { readInputDraft, resolveSessionInput } from './composer.ts'

/** 从最新快照读一个 Tab（meta 合并写入前的读取面；布局即注册表）。 */
export function readTab(ctx: Context, tabId: string): SidebarTab | undefined {
  return collectTabs(ctx.betterSidebar.getSnapshot().state).find(tab => tab.id === tabId)
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

    // 新建：openTab 走 createTab 铸造（seed.meta 会被忽略），所以先记下既有
    // id 集，openTab 同步落状态后找出新 Tab，再把 pendingDraft 写进它的 meta。
    const before = new Set(collectTabs(snapshot.state).map(tab => tab.id))
    ctx.betterSidebar.openTab({ type: SIDE_TAB_TYPE }, { sessionId })
    const created = collectSideTabs(ctx.betterSidebar.getSnapshot().state).find(tab => !before.has(tab.id))
    if (created === undefined) return false
    if (draftText !== undefined && draftText !== '') {
      ctx.betterSidebar.updateTab(created.id, { meta: { pendingDraft: draftText } })
    }
    return true
  } catch (error) {
    console.warn('[dsh-sidechat] 打开侧边聊天失败:', error)
    return false
  }
}
