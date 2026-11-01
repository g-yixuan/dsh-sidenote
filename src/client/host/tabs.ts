import type { Context, NativeTabRecord } from './contracts.ts'
import { sidebarRightOf } from './sidebar.ts'

/** Read actual layout membership, including tabs whose bodies have not mounted. */
export function nativeTabsOf(ctx: Context, sessionId: string) {
  return sidebarRightOf(ctx)?.tabsIn?.(sessionId) ?? []
}

export function activeNativeTabOf(ctx: Context) {
  return sidebarRightOf(ctx)?.active?.()
}

/** Public TabDomain navigation revision: 0 means restored/seeded, positive
 * means opened by address. Unknown shapes cannot reclaim another generation. */
export function isRestoredNativeTab(record: NativeTabRecord): boolean {
  return record.navigation.revision === 0
}
