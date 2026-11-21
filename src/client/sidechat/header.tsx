/**
 * 顶栏「侧边」入口（Delivery_02 Workitem_02 发现性）：注册进宿主的
 * `conversation.session.header.utilities` 槽位（会话头部右上角的工具条，
 * 「Session log」所在处）——侧边聊天从此有一个永远可见的视觉入口，
 * 不再只有 /side 斜杠命令和「+」菜单。
 *
 * 行为 = 打开或聚焦侧边聊天（与 bridge 同一编排 openOrFocusSideChat）。
 * blank 着陆页会话（无已完成 turn、fork 必败）不渲染按钮。
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconNewChatOutline16 } from '../host/icons.ts'
import type { Context } from '../host/contracts.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { canForkFrom } from './model.ts'
import { openOrFocusSideChat } from './open.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

function HeaderSideButton({ ctx }: { ctx: Context }): ReactNode {
  useLocaleTick()
  // 订阅会话列表：当前会话切换 / blank→非blank 时按钮显隐跟随。
  const listSnap = useSyncExternalStore(
    (notify) => ctx.sessions.list.subscribe(notify),
    () => ctx.sessions.list.getSnapshot(),
  )
  // 0.1.7 的 SessionListState 已无 current——双源（list.current / DOM
  // data-conversation-session）。uSES 订阅保留以驱动会话切换后的重读。
  void listSnap
  const sessionId = currentSessionIdOf(ctx)
  if (sessionId === '' || !canForkFrom(ctx, sessionId)) return null

  return (
    <Tooltip label={t('headerSideTitle')} side="bottom"><button
      type="button"
      className={css.headerSide}
      aria-label={t('headerSideTitle')}
      onClick={() => { openOrFocusSideChat(ctx, sessionId) }}
    >
      <IconNewChatOutline16 size={13} />
      <span>{t('headerSide')}</span>
    </button></Tooltip>
  )
}

export function registerHeaderEntry(ctx: Context): void {
  try {
    ctx.slots.inject('conversation.session.header.utilities', () => {
      return ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-sidenote-header',
        order: 10,
        registrant: 'dsh-sidenote',
      }, () => <HeaderSideButton ctx={ctx} />)
    })
  } catch (error) {
    console.warn('[dsh-sidenote] 顶栏入口注册失败（Tab 与 /side 不受影响）:', error)
  }
}
