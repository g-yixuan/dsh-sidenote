/**
 * /side 斜杠命令（spike 落点）：经 client 侧 `ctx.commandUi.register`
 * （dsh-client-ui-commands 的 CommandContribution，ui 形态 popupSelect）
 * 注册。popupSelect 是该注册面唯一的 UI 形态 —— 菜单行被选中后弹一个
 * 选项壳，选项 = 新建 + 当前会话已并存的侧边聊天（聚焦）+ 最近关闭（重开）。
 * native 宿主（better-sidebar >= 0.19）受 dsh sidebar-right 的 held 规则约束
 * （page kind 每 pane 单实例）：有存活实例时不列「新建」与「重开」。
 *
 * 服务经 ctx.get 惰性解析（commandUi 不在 inject 清单里）：服务缺失、
 * 注册抛错（如与 host 命令撞名）都降级为「只有 Tab 入口」，绝不影响面板。
 *
 * 中文别名「侧边」：宿主命令过滤只匹配命令名、不匹配描述（B1 实测中文用户
 * 输「/侧边」候选直接清空）——注册双名让中文关键词直达。
 */
import type { Context } from '../host/contracts.ts'
import { canForkFrom, collectSideTabs } from './model.ts'
import { focusNativeTab, liveSideChatsOf, nativeSidebarHost } from './native.ts'
import { createSideChat, reopenSideChat } from './open.ts'
import { dropClosedSideChat, listClosedSideChats } from './recentClosed.ts'
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

/** 单个命令名对应的完整贡献（side / 侧边 共用）。 */
function makeContribution(ctx: Context, name: string) {
  return {
    name,
    description: isDsh015Plus(ctx) ? () => t('cmdDesc') : t('cmdDesc'),
    available: (session: CommandSession) => canForkFrom(ctx, session.sessionId),
    ui: {
      kind: 'popupSelect' as const,
      options: (session: CommandSession) => {
        const options: SelectOption[] = []
        const native = nativeSidebarHost(ctx)
        const lives = native ? liveSideChatsOf(session.sessionId) : []
        // native 下同 kind 每 pane 单实例（dsh-client-ui-sidebar-right 的 held
        // 规则：page kind 的 contentId 恒为 sidebar://<kind>，openTab 必折叠为
        // 聚焦既有 tab）——已有存活实例时「新建」名不副实，不列。
        if (!native || lives.length === 0) {
          options.push({ id: 'new', label: t('cmdNew'), detail: t('cmdNewDetail') })
        }
        // 已并存的侧边聊天列为聚焦项（命令弹层即多实例管理入口）。
        // native（>= 0.19）：tab 不进布局快照，枚举改读 live registry；
        // legacy：读布局快照（现状）。
        if (native) {
          for (const live of lives) {
            options.push({ id: `focus:${live.tabId}`, label: t('cmdFocus', { title: live.readTitle() }), detail: t('cmdFocusDetail') })
          }
        } else {
          const snapshot = ctx.betterSidebar.getSnapshot()
          if (snapshot.sessionId === session.sessionId && snapshot.state !== undefined) {
            for (const tab of collectSideTabs(snapshot.state)) {
              options.push({ id: `focus:${tab.id}`, label: t('cmdFocus', { title: tab.title }), detail: t('cmdFocusDetail') })
            }
          }
        }
        // D3 后悔药：最近关闭的可重开（Cmd+Shift+T 心智）。
        // native 单实例约束下，有存活实例时 reopen 必被 held 折叠（seed.meta
        // 丢弃且聚焦错对象）——此时不列重开项。
        if (!(native && lives.length > 0)) {
          for (const entry of listClosedSideChats(session.sessionId)) {
            options.push({ id: `reopen:${entry.childId}`, label: t('cmdReopen', { title: entry.title }), detail: t('cmdReopenDetail') })
          }
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
          // native 宿主的 activateTab 是空操作——聚焦走 ISidebarRight.focus 探测。
          if (!focusNativeTab(ctx, tabId)) ctx.betterSidebar.activateTab(tabId, { sessionId: session.sessionId })
          return
        }
        if (option.id.startsWith('reopen:')) {
          const childId = option.id.slice('reopen:'.length)
          if (reopenSideChat(ctx, session.sessionId, childId)) {
            dropClosedSideChat(session.sessionId, childId)
          }
        }
      },
    },
  }
}

/** 注册 /side 与中文别名「/侧边」；不可行时静默降级（不影响 Tab 入口）。 */
export function registerSideCommand(ctx: Context): void {
  let commandUi: CommandUiService | undefined
  try {
    commandUi = ctx.get('commandUi') as CommandUiService | undefined
  } catch {
    return
  }
  if (commandUi === undefined || typeof commandUi.register !== 'function') return
  for (const name of ['side', '侧边']) {
    try {
      ctx.effect(() => commandUi.register(makeContribution(ctx, name)), `dsh-sidenote: /${name} command`)
    } catch (error) {
      console.warn(`[dsh-sidenote] /${name} 命令注册失败（Tab 入口不受影响）:`, error)
    }
  }
}
