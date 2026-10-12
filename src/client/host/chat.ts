import type { Context, ConversationSnapshot, SessionBinding, SessionReference, UiConversationLike } from './contracts.ts'

/** Durable conversation content; local submission echoes are never part of this face. */
export interface ChatSource {
  subscribe(fn: () => void): () => void
  getLegacy(): ConversationSnapshot | null
}

export function chatSourceOf(ctx: Context, binding: SessionBinding | undefined): ChatSource | undefined {
  const session = binding?.session
  if (session === undefined) return undefined
  try {
    const ui = ctx.get('uiConversation') as UiConversationLike | undefined
    const target = ui?.binding?.(binding)?.target?.('chat')
    if (typeof target?.getSnapshot === 'function' && typeof target.subscribe === 'function') {
      return {
        subscribe: fn => target.subscribe(fn),
        getLegacy: () => (target.getSnapshot() as { legacy?: ConversationSnapshot } | undefined)?.legacy ?? null,
      }
    }
  } catch { /* Older hosts keep durable nodes on Session itself. */ }
  const snap = session.getSnapshot()
  return Array.isArray(snap?.nodes)
    ? { subscribe: fn => session.subscribe(fn), getLegacy: () => session.getSnapshot() }
    : undefined
}

/** Retain the exact target generation on hosts that expose session ownership. */
export function retainSession(ctx: Context, sessionId: string, signal?: AbortSignal): SessionReference | undefined {
  return ctx.sessions.retain?.(sessionId, { source: 'dsh-sidenote', ...(signal === undefined ? {} : { signal }) })
}
