/** /side offers explicit creation, focusing open tabs, and reopening original children. */
import type { Context } from '../host/contracts.ts'
import { canForkFrom, collectSideTabs } from './model.ts'
import { betterSidebarOf, directNativeLeg, focusNativeTab } from './native.ts'
import { createSideChat, reopenSideChat, sideChatTabsOf } from './open.ts'
import { dropClosedSideChat, listClosedSideChats } from './recentClosed.ts'
import { formatClosedAt, sideChatTitleOf } from './identity.ts'
import { t } from '../locales.ts'

/** dsh-client-ui-commands ClientSessionContext 的最小镜像（只有 sessionId）。 */
interface CommandSession {
  readonly sessionId: string
}

/** popupSelect 选项行镜像。 */
interface SelectOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

/** ctx.commandUi 的最小镜像（CommandUiContract.register）。 */
interface CommandUiService {
  register(contribution: {
    readonly name: string
    readonly label?: () => string
    // 契约在 0.1.5 从 string 改为 () => string（authority:
    // dsh-client-ui-commands 0.1.5-rc.2 contract.d.ts `readonly description: () => string`；
    // 0.1.1~0.1.3 为 string）。传错形状会在候选合成时炸掉整个斜杠菜单
    // （ui-input-trigger 的 contribution.description() 对 string 抛 TypeError）。
    readonly description: string | (() => string)
    available(session: CommandSession): boolean
    readonly ui: {
      readonly kind: 'popupSelect'
      options(session: CommandSession, signal: AbortSignal): Promise<readonly SelectOption[]>
      onSelect(option: SelectOption, session: CommandSession): void | Promise<void>
    }
  }): () => void
}

/** 0.1.5 信号：`connection.api.sessions` 面在 0.1.5 被删（与模型面迁移同判据）。 */
function isDsh015Plus(ctx: Context): boolean {
  const legacy = (ctx as { connection?: { api?: { sessions?: unknown } } }).connection?.api?.sessions
  return legacy === undefined || legacy === null
}

/** One canonical command; localized labels participate in the host's menu search. */
function makeContribution(ctx: Context) {
  return {
    name: 'side',
    label: () => t('headerSide'),
    description: isDsh015Plus(ctx) ? () => t('cmdDesc') : t('cmdDesc'),
    available: (session: CommandSession) => canForkFrom(ctx, session.sessionId),
    ui: {
      kind: 'popupSelect' as const,
      options: (session: CommandSession) => {
        const options: SelectOption[] = []
        const native = directNativeLeg(ctx)
        const lives = native ? sideChatTabsOf(ctx, session.sessionId) : []
        options.push({ id: 'new', label: t('cmdNew'), detail: t('cmdNewDetail') })
        // 已并存的侧边聊天列为聚焦项（命令弹层即多实例管理入口）。
        // Native membership comes from DSH, including not-yet-mounted tabs;
        // legacy：读布局快照（现状）。
        if (native) {
          for (const tab of lives) {
            const meta = tab.meta
            options.push({ id: `focus:${tab.id}`, label: t('cmdFocus', { title: meta ? sideChatTitleOf(meta) : tab.title }), detail: t('cmdFocusDetail') })
          }
        } else {
          const snapshot = betterSidebarOf(ctx)?.getSnapshot()
          if (snapshot !== undefined && snapshot.sessionId === session.sessionId && snapshot.state !== undefined) {
            for (const tab of collectSideTabs(snapshot.state)) {
              options.push({ id: `focus:${tab.id}`, label: t('cmdFocus', { title: tab.title }), detail: t('cmdFocusDetail') })
            }
          }
        }
        const openChildren = new Set(lives.map(tab => tab.meta?.childId))
        for (const entry of listClosedSideChats(session.sessionId)) {
          if (openChildren.has(entry.childId)) continue
          options.push({
            id: `reopen:${entry.childId}`,
            label: t('cmdReopen', { title: entry.topic ?? entry.title }),
            detail: formatClosedAt(entry.closedAt),
          })
        }
        return Promise.resolve(options)
      },
      onSelect: (option: SelectOption, session: CommandSession) => {
        if (option.id === 'new') {
          // 「新建侧边聊天」必须真新建——既有实例的聚焦项在弹层里另列，
          // 走 openOrFocusSideChat 会在已有侧边聊天时静默聚焦（标签说谎）。
          createSideChat(ctx, session.sessionId)
          return
        }
        if (option.id.startsWith('focus:')) {
          const tabId = option.id.slice('focus:'.length)
          // native 宿主的 activateTab 是空操作——聚焦走 ISidebarRight.focus 探测；
          // betterSidebar 缺席（optional peer）时无回退面，跳过。
          if (!focusNativeTab(ctx, tabId)) betterSidebarOf(ctx)?.activateTab(tabId, { sessionId: session.sessionId })
          return
        }
        if (option.id.startsWith('reopen:')) {
          const childId = option.id.slice('reopen:'.length)
          // topic 随重开恢复（Delivery_05）：option 只带 id，回查登记处取条目。
          const entry = listClosedSideChats(session.sessionId).find(e => e.childId === childId)
          const opts = entry === undefined ? undefined : {
            ...(entry.topic !== undefined ? { topic: entry.topic } : {}),
            ...(entry.savedMeta !== undefined ? { savedMeta: entry.savedMeta } : {}),
          }
          if (reopenSideChat(ctx, session.sessionId, childId, opts)) {
            dropClosedSideChat(session.sessionId, childId)
          }
        }
      },
    },
  }
}

/** Register /side once, with a localized searchable label rather than a duplicate alias row. */
export function registerSideCommand(ctx: Context): void {
  let commandUi: CommandUiService | undefined
  try {
    commandUi = ctx.get('commandUi') as CommandUiService | undefined
  } catch {
    return
  }
  if (commandUi === undefined || typeof commandUi.register !== 'function') return
  try {
    ctx.effect(() => commandUi.register(makeContribution(ctx)), 'dsh-sidenote: /side command')
  } catch (error) {
    console.warn('[dsh-sidenote] /side command registration failed:', error)
  }
}
