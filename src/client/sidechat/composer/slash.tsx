/**
 * 侧边 composer 的斜杠/@ 触发菜单（WI-02）：官方触发引擎（inputTriggers
 * 控制器的公开契约面：track/arbitrate/pick/dismiss + menu store）+
 * 自绘菜单皮（MenuView 不导出——技术审查 A5 证伪，primitives Menu 做皮）。
 *
 * 接线面（全是公开契约，非 off-face 键盘面）：
 * - onChange → controller.track(draft, caret, guardOf(phase), draftRev)
 * - onKeyDown（菜单开着）→ controller.arbitrate(key, composing)
 * - 点击候选 → controller.pick(source, index)
 * - 外部点击/Esc → controller.dismiss()
 *
 * 全局 source 涌入裁决（C-6）：侧边会话的菜单会涌入全局注册的 source
 * （/side 自己、skill、@file 等）——「不可嵌套」把 /side、/侧边 过滤掉
 * （source 名按注册名匹配），其余放行（与主对话同能力）。
 */
import { useSyncExternalStore } from 'react'
import css from '../sidechat.module.css'
import type { Context, SessionInput } from '../../host/contracts.ts'

/** TriggerGuard 推导（宿主 guardOf 的 3 行复刻：plain 全活 / claimed 只活 @ / 其余全灭）。 */
export function guardOf(phase: string | undefined): 'plain' | 'claimed' | 'frozen' {
  if (phase === 'plain') return 'plain'
  if (phase === 'claimed') return 'claimed'
  return 'frozen'
}

/** 侧边会话里要过滤的 source（不可嵌套 P2-3：侧聊里不再开侧聊）。 */
const EXCLUDED_SOURCES = new Set(['side', '侧边'])

/** MenuState 的最小镜像（input-trigger core/contract.d.ts）。 */
export interface SlashMenuState {
  readonly open: boolean
  readonly groups: readonly {
    readonly source: string
    readonly status: 'pending' | 'ready'
    readonly items: readonly { readonly name: string; readonly description?: string; readonly icon?: string; readonly hint?: string }[]
  }[]
  readonly highlight: { readonly source: string; readonly index: number } | null
}

/** 触发控制器镜像（公开契约面；技术审查 A3 实证非 off-face）。 */
export interface TriggerController {
  readonly menu: { subscribe(fn: () => void): () => void; getSnapshot(): SlashMenuState }
  track(draft: string, caret: number, guard: 'plain' | 'claimed' | 'frozen', draftRev: number): void
  pick(source: string, index: number): void
  arbitrate(key: string, composing: boolean): 'consumed' | 'pick-highlighted' | 'pass'
  dismiss(): void
}

/** 解析侧边会话的触发控制器（缺席/异常 → null，菜单整体不出现）。 */
export function resolveTriggerController(ctx: Context, childId: string | undefined): TriggerController | null {
  if (childId === undefined) return null
  try {
    const actx = ctx.sessions.scope(childId)
    if (actx === undefined) return null
    const svc = ctx.get('inputTriggers') as { sessionOf?: (a: unknown) => unknown } | undefined
    const controller = svc?.sessionOf?.(actx) as TriggerController | undefined
    if (controller === undefined || controller === null) return null
    if (typeof controller.track !== 'function' || typeof controller.pick !== 'function') return null
    return controller
  } catch {
    return null
  }
}

export interface SlashMenuHandle {
  readonly state: SlashMenuState
  readonly controller: TriggerController
}

/** 订阅控制器 menu store；controller 缺席返回 null。 */
export function useSlashMenuState(controller: TriggerController | null): SlashMenuState | null {
  return useSyncExternalStore(
    (fn) => controller?.menu.subscribe(fn) ?? (() => {}),
    () => controller?.menu.getSnapshot() ?? null,
  )
}

/** 过滤后的可视分组（排除不可嵌套源 + 空组）。 */
export function visibleGroups(state: SlashMenuState | null): SlashMenuState['groups'] {
  if (state === null || !state.open) return []
  return state.groups.filter(g => !EXCLUDED_SOURCES.has(g.source) && g.items.length > 0)
}

// ── 菜单皮（自绘，L2）──────────────────────────────────────────────────────

/** 键盘键 → 仲裁键映射（非仲裁键返回 null = 放行）。 */
export function arbitrateKeyOf(key: string): 'up' | 'down' | 'enter' | 'escape' | null {
  if (key === 'ArrowUp') return 'up'
  if (key === 'ArrowDown') return 'down'
  if (key === 'Enter') return 'enter'
  if (key === 'Escape') return 'escape'
  return null
}

/**
 * 斜杠菜单浮层（composer 上方，绝对定位）。分组渲染（source 组头）+
 * 高亮跟随 controller 的 highlight store + 点击 pick。
 */
export function SlashMenuView(props: {
  state: SlashMenuState
  onPick: (source: string, index: number) => void
}) {
  const groups = visibleGroups(props.state)
  if (groups.length === 0) return null
  const highlight = props.state.highlight
  return (
    <div className={css.slashMenu} role="listbox" aria-label="commands">
      {groups.map(group => (
        <div key={group.source}>
          <div className={css.slashGroupTitle}>{group.source}</div>
          {group.items.map((item, index) => {
            const active = highlight !== null && highlight.source === group.source && highlight.index === index
            return (
              <button
                key={`${group.source}:${index}`}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? css.slashItemActive : css.slashItem}
                onMouseDown={(event) => {
                  // mousedown 抢在 textarea blur 前（保持焦点在输入框）。
                  event.preventDefault()
                  props.onPick(group.source, index)
                }}
              >
                <span className={css.slashItemName}>{item.icon !== undefined && item.icon !== '' ? `${item.icon} ` : ''}{item.name}</span>
                {item.description !== undefined && item.description !== '' && (
                  <span className={css.slashItemDetail}>{item.description}</span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
