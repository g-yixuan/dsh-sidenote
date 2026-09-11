/**
 * Client half of dsh-sidenote: the side-chat tabs (Workitem 01) and the
 * selection annotations (Workitem 02). Thin consumer of dsh-better-sidebar —
 * it builds no panel chrome (portal/resize/collapse/persistence); the panel
 * container is entirely better-sidebar's.
 *
 * Requires the `betterSidebar` service (hard peer dependency): inject keeps
 * the plugin inactive until better-sidebar provides it.
 */
import type { Context } from './host/contracts.ts'
import { probeHost } from './host/probes.ts'
import { attachLocale, type LocaleServiceLike } from './locales.ts'
import { createReflowStore } from './reflow.ts'
import { registerSideChat } from './sidechat/index.tsx'
import { registerAnnotations } from './annotate/index.tsx'
import { setRootContext } from './sidechat/native.ts'

export const inject = ['betterSidebar', 'sessions', 'workspaces', 'slots', 'connection', 'locale']

export function apply(ctx: Context): void {
  // 侧栏 Tab 的原生面（better-sidebar >= 0.19）与宿主调用都要用插件根 ctx：
  // 面板拿到的是 slot 注入的收缩 ctx（inject 里没有 workspaces），见 native.ts。
  setRootContext(ctx)
  // 跟随 DSH 通用设置里的语言（locale.preference，Host-backed，实时切换）。
  attachLocale(ctx.locale as LocaleServiceLike | undefined)
  // T2 off-face 全景探测：宿主升级后哪些能力降级了，开发者工具里一眼可见。
  probeHost(ctx)
  // 回流 store 两个模块共享：sidechat 生产（回流按钮），annotate 消费
  // （chip + 发送拦截器序列化）。
  const reflow = createReflowStore()
  registerSideChat(ctx, reflow)
  registerAnnotations(ctx, reflow)
}
