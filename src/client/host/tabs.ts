import type { NativeTabRecord } from './contracts.ts'

/** Public TabDomain navigation revision: 0 means restored/seeded, positive
 * means opened by address. Unknown shapes cannot reclaim another generation. */
export function isRestoredNativeTab(record: NativeTabRecord): boolean {
  return record.navigation.revision === 0
}
