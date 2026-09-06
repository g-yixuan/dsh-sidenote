/**
 * Client half of dsh-sidenote: the side-chat tabs (Workitem 01) and the
 * selection annotations (Workitem 02). Thin consumer of dsh-better-sidebar —
 * it builds no panel chrome (portal/resize/collapse/persistence); the panel
 * container is entirely better-sidebar's.
 *
 * Requires the `betterSidebar` service (hard peer dependency): inject keeps
 * the plugin inactive until better-sidebar provides it.
 */
import type { Context } from '../context-types.ts'
import { attachLocale, type LocaleServiceLike } from './locales.ts'
import { createReflowStore } from './reflow.ts'
import { registerSideChat } from './sidechat/index.tsx'
import { registerAnnotations } from './annotate/index.tsx'

export const inject = ['betterSidebar', 'sessions', 'workspaces', 'slots', 'connection', 'locale']

export function apply(ctx: Context): void {
  // 跟随 DSH 通用设置里的语言（locale.preference，Host-backed，实时切换）。
  attachLocale(ctx.locale as LocaleServiceLike | undefined)
  // 回流 store 两个模块共享：sidechat 生产（回流按钮），annotate 消费
  // （chip + 发送拦截器序列化）。
  const reflow = createReflowStore()
  registerSideChat(ctx, reflow)
  registerAnnotations(ctx, reflow)
}
