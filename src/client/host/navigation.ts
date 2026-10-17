import type { Context } from './contracts.ts'
import { rootContext } from './sidebar.ts'

/** uiWorkspace owns navigation on newer hosts; historical hosts use sessions.open. */
export function openSession(ctx: Context, sessionId: string): void {
  const owner = rootContext(ctx)
  const workspace = owner.get('uiWorkspace') as { openSession?: (id: string) => void } | undefined
  if (typeof workspace?.openSession === 'function') { workspace.openSession(sessionId); return }
  if (typeof owner.sessions.open === 'function') { owner.sessions.open(sessionId); return }
  throw new Error('Host session navigation is unavailable')
}
