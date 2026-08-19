/**
 * /side 斜杠命令（spike 落点）：经 client 侧 `ctx.commandUi.register`
 * （dsh-client-ui-commands 的 CommandContribution，ui 形态 popupSelect）
 * 注册。popupSelect 是该注册面唯一的 UI 形态 —— 菜单行被选中后弹一个
 * 选项壳，选项 = 新建 + 当前会话已并存的侧边聊天（聚焦）。
 *
 * 服务经 ctx.get 惰性解析（commandUi 不在 inject 清单里）：服务缺失、
 * 注册抛错（如与 host 命令撞名）都降级为「只有 Tab 入口」，绝不影响面板。
 */
import type { Context } from '../../context-types.ts'
import { canForkFrom, collectSideTabs } from './model.ts'
import { openOrFocusSideChat } from './open.ts'
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
    readonly description: string
    available(session: CommandSession): boolean
    readonly ui: {
      readonly kind: 'popupSelect'
      options(session: CommandSession, signal: AbortSignal): Promise<readonly SelectOption[]>
      onSelect(option: SelectOption, session: CommandSession): void | Promise<void>
    }
  }): () => void
}

/** 注册 /side 命令；不可行时静默降级（返回 undefined）。 */
export function registerSideCommand(ctx: Context): void {
  let commandUi: CommandUiService | undefined
  try {
    commandUi = ctx.get('commandUi') as CommandUiService | undefined
  } catch {
    return
  }
  if (commandUi === undefined || typeof commandUi.register !== 'function') return
  try {
    ctx.effect(() => commandUi.register({
      name: 'side',
      description: t('cmdDesc'),
      available: (session) => canForkFrom(ctx, session.sessionId),
      ui: {
        kind: 'popupSelect',
        options: (session) => {
          const options: SelectOption[] = [
            { id: 'new', label: t('cmdNew'), detail: t('cmdNewDetail') },
          ]
          // 已并存的侧边聊天列为聚焦项（命令弹层即多实例管理入口）。
          const snapshot = ctx.betterSidebar.getSnapshot()
          if (snapshot.sessionId === session.sessionId && snapshot.state !== undefined) {
            for (const tab of collectSideTabs(snapshot.state)) {
              options.push({ id: `focus:${tab.id}`, label: t('cmdFocus', { title: tab.title }), detail: t('cmdFocusDetail') })
            }
          }
          return Promise.resolve(options)
        },
        onSelect: (option, session) => {
          if (option.id === 'new') {
            openOrFocusSideChat(ctx, session.sessionId)
            return
          }
          if (option.id.startsWith('focus:')) {
            ctx.betterSidebar.activateTab(option.id.slice('focus:'.length), { sessionId: session.sessionId })
          }
        },
      },
    }), 'dsh-sidechat: /side command')
  } catch (error) {
    console.warn('[dsh-sidechat] /side 命令注册失败（Tab 入口不受影响）:', error)
  }
}
