/**
 * Workitem 01 — 侧边聊天面板。
 *
 * 注册「侧边聊天」Tab 类型（dsh-sidechat:side，多实例一等公民）：
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
import type { Context } from '../../context-types.ts'
import { sideChatBridge } from '../bridge.ts'
import { SideChatPanel } from './SideChatPanel.tsx'
import { SIDE_TAB_TYPE, canForkFrom, collectSideTabs, mintSideTabId, sideTabTitle } from './model.ts'
import { openOrFocusSideChat } from './open.ts'
import { t } from '../locales.ts'
import { registerSideCommand } from './slash.ts'

export function registerSideChat(ctx: Context): void {
  ctx.effect(
    () => ctx.betterSidebar.registerTab({
      id: SIDE_TAB_TYPE,
      title: () => t('menuTitle'),
      icon: (size: number) => <IconNewChatOutline16 size={size} />,
      order: 60,
      available: (availableCtx, scope) => canForkFrom(availableCtx, scope.sessionId),
      createTab: (state) => ({
        tab: { id: mintSideTabId(), type: SIDE_TAB_TYPE, title: sideTabTitle(collectSideTabs(state).map(tab => tab.title)) },
      }),
      component: (props) => <SideChatPanel {...props} />,
    }),
    'dsh-sidechat: side chat tab',
  )

  // annotate 桥：「在侧边聊天中提问」= 新建或聚焦一个侧边聊天 Tab 并写入草稿。
  ctx.effect(() => {
    const impl = {
      askInSideChat: (sessionId: string, draftText: string): boolean =>
        openOrFocusSideChat(ctx, sessionId, draftText),
    }
    sideChatBridge.current = impl
    return () => {
      if (sideChatBridge.current === impl) sideChatBridge.current = null
    }
  }, 'dsh-sidechat: annotate bridge')

  registerSideCommand(ctx)
}
