/**
 * dsh-sidechat host half: currently empty by design — every feature is
 * client-side (sessions RPC + the betterSidebar service). A host half would
 * only appear for capabilities the client cannot reach (none today).
 */
import type { Context } from './context-types.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-sidechat'

export function apply(_ctx: Context): void {
  // No host services yet.
}
