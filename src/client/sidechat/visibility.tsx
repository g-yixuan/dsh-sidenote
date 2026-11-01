import type { Context } from '../host/contracts.ts'
import { registerSessionListFilter } from '../host/sessionList.tsx'
import { sessionVisibilityOf } from '../host/sessionVisibility.ts'
import { storedSideChatMetas } from './metaStore.ts'
import { allClosedSideChats } from './recentClosed.ts'

/** Run before orphan-meta cleanup so previous live/closed children can migrate. */
export function registerSideSessionVisibility(ctx: Context): void {
  const visibility = sessionVisibilityOf(ctx)
  const ids = [...storedSideChatMetas(), ...allClosedSideChats()].flatMap(record => record.childId ? [record.childId] : [])
  visibility.hide(...ids)
  ctx.effect(() => visibility.watch(), 'dsh-sidenote: side session visibility')
  registerSessionListFilter(ctx, visibility)
}
