/**
 * Workitem 01 — 侧边聊天面板。
 *
 * 注册「侧边聊天」Tab 类型（dsh-sidenote:side，多实例一等公民）：
 * - + 菜单可见（order 60，terminal=40 / browser=50 之后）；菜单行标题
 *   「侧边聊天」，铸造出的 Tab 标题为「侧边」/「侧边 N」（createTab 按
 *   当前并存数编号 —— 带 createTab 的 descriptor 会被 openTab 忽略
 *   seed.title，编号必须在铸造处完成）；
 * - createTab 铸 `side:<uuid>`（crypto.randomUUID()）多实例 id；
 * - blank 着陆页会话没有已完成 turn、fork 必败 → available 禁用 +
 *   面板内错误态双保险；
 * - Tab × 关闭即从界面消失（better-sidebar 关 tab 即出布局，meta 随之
 *   消失；jsonl 留盘是设计意图，不做删除）。
 *
 * 另安装：annotate 桥（sideChatBridge.current，WI-03 联动缝）与 /side
 * 斜杠命令（spike，popupSelect 形态，不可行时降级为只有 Tab 入口）。
 */
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../host/contracts.ts'
import { sideChatBridge } from '../bridge.ts'
import type { ReflowStore } from '../reflow.ts'
import { SideChatPanel } from './SideChatPanel.tsx'
import { SIDE_TAB_TYPE, canForkFrom, collectSideTabs, mintSideTabId, sideTabTitle } from './model.ts'
import { parseSideChatMeta } from './model.ts'
import { recordClosedSideChat } from './recentClosed.ts'
import { liveSideChatsOf, nativeSidebarHost } from './native.ts'
import { openOrFocusSideChat, sideChatTargetTitle } from './open.ts'
import { t } from '../locales.ts'
import { registerHeaderEntry } from './header.tsx'
import { registerSideCommand } from './slash.ts'
import { registerSideChatReferenceSource } from './referenceSource.ts'
import { registerToastHost } from './toast.tsx'
import { registerCompletionNotify } from './notify.ts'

export function registerSideChat(ctx: Context, reflow: ReflowStore): void {
  ctx.effect(
    () => ctx.betterSidebar.registerTab({
      id: SIDE_TAB_TYPE,
      title: () => t('menuTitle'),
      icon: (size: number) => <IconNewChatOutline16 size={size} />,
      order: 60,
      available: (availableCtx, scope) => canForkFrom(availableCtx, scope.sessionId),
      createTab: (state) => {
        // 标题编号数据源：legacy 读布局快照；native 的 tab 不进快照，并入
        // live registry（当前会话——openTab 的会话守卫保证 state 属在屏会话）。
        const titles = collectSideTabs(state).map(tab => tab.title)
        if (nativeSidebarHost(ctx)) {
          const current = ctx.sessions.list.getSnapshot().current
          if (current !== undefined) {
            for (const live of liveSideChatsOf(current)) titles.push(live.readTitle())
          }
        }
        return { tab: { id: mintSideTabId(), type: SIDE_TAB_TYPE, title: sideTabTitle(titles) } }
      },
      // × 即焚观感 + 后悔药：关 Tab 时登记「最近关闭」（会话本体仍归档在盘）。
      onClose: (closedTab) => {
        const meta = parseSideChatMeta(closedTab.meta)
        if (meta.childId !== undefined && meta.parentSessionId !== undefined) {
          recordClosedSideChat(meta.parentSessionId, {
            childId: meta.childId,
            parentSessionId: meta.parentSessionId,
            title: closedTab.title,
            closedAt: Date.now(),
          })
        }
      },
      component: (props) => <SideChatPanel {...props} reflow={reflow} />,
    }),
    'dsh-sidenote: side chat tab',
  )

  // annotate 桥：「在侧边聊天中提问」= 新建或聚焦一个侧边聊天 Tab 并写入草稿。
  ctx.effect(() => {
    const impl = {
      askInSideChat: (sessionId: string, draftText: string): boolean =>
        openOrFocusSideChat(ctx, sessionId, draftText),
      peekTargetTitle: (sessionId: string): string | undefined =>
        sideChatTargetTitle(ctx, sessionId),
    }
    sideChatBridge.current = impl
    return () => {
      if (sideChatBridge.current === impl) sideChatBridge.current = null
    }
  }, 'dsh-sidenote: annotate bridge')

  registerSideCommand(ctx)
  // WI-04：主输入框 @ 引用侧边聊天（触发源 + codec 序列化）。
  registerSideChatReferenceSource(ctx)
  // 顶栏「侧边」入口（发现性）：会话头部右上角常驻按钮。
  registerHeaderEntry(ctx)
  // 全局瞬态通知宿主（P4：转正确认等跨 Tab 寿命的反馈）。
  registerToastHost(ctx)
  // 完成通知（WI-03）：侧聊 running 翻转 → toast。
  registerCompletionNotify(ctx)
}
