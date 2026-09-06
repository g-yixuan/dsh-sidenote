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
  sideTabTitle,
} from './model.ts'
import { readInputDraft, resolveSessionInput } from './composer.ts'
import { truncateQuote } from '../annotate/format.ts'
import { t } from '../locales.ts'

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
    return sideTabTitle([])
  } catch {
    return undefined
  }
}

/**
 * 回流通道（Delivery_02 Workitem_04）：把侧边聊天里的一段 assistant 结论
 * 以引用形态注入**主会话**的 composer 草稿（用户审阅/编辑后再发送，
 * 不直接发）。Codex 无回流、Cursor 靠 @-mention——这是我们的反超点。
 * @returns false = 主会话输入机不可达（调用方决定提示与否）。
 */
export function reflowToMainSession(ctx: Context, parentSessionId: string, text: string, sideTitle: string): boolean {
  try {
    const input = resolveSessionInput(ctx, parentSessionId)
    if (input === null) return false
    const quote = truncateQuote(text).split('\n').map(line => (line === '' ? '>' : `> ${line}`)).join('\n')
    const block = `> ${t('reflowFrom', { title: sideTitle })}\n${quote}`
    input.setDraft(appendDraftText(readInputDraft(input), block))
    return true
  } catch (error) {
    console.warn('[dsh-sidenote] 回流主会话失败:', error)
    return false
  }
}
