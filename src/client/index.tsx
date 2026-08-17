/**
 * Client half of dsh-side-chat: the side-chat tabs (Workitem 01) and the
 * selection annotations (Workitem 02). Thin consumer of dsh-better-sidebar —
 * it builds no panel chrome (portal/resize/collapse/persistence); the panel
 * container is entirely better-sidebar's.
 *
 * Requires the `betterSidebar` service (hard peer dependency): inject keeps
 * the plugin inactive until better-sidebar provides it.
 */
import type { Context } from '../context-types.ts'
import { registerSideChat } from './sidechat/index.tsx'
import { registerAnnotations } from './annotate/index.tsx'

export const inject = ['betterSidebar', 'sessions', 'workspaces', 'slots']

export function apply(ctx: Context): void {
  registerSideChat(ctx)
  registerAnnotations(ctx)
}
