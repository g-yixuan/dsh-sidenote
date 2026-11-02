import type { Context, NativeTabRecord } from './contracts.ts'
import { sidebarRightOf } from './sidebar.ts'

/** Read actual layout membership, including tabs whose bodies have not mounted. */
export function nativeTabsOf(ctx: Context, sessionId: string) {
  return sidebarRightOf(ctx)?.tabsIn?.(sessionId) ?? []
}

export function activeNativeTabOf(ctx: Context) {
  return sidebarRightOf(ctx)?.active?.()
}

/** An async action must not close a replacement restored under the same tab id. */
export function closeNativeTab(tab: Pick<NativeTabRecord, 'signal' | 'actions'>): void {
  if (!tab.signal.aborted) tab.actions.close()
}

/** Public TabDomain navigation revision: 0 means restored/seeded, positive
 * means opened by address. Unknown shapes cannot reclaim another generation. */
export function isRestoredNativeTab(record: NativeTabRecord): boolean {
  return record.navigation.revision === 0
}
