import type { Context, ConversationSnapshot, ObservableSnapshot, SessionBinding, SessionFace, SessionReference, UiConversationLike } from './contracts.ts'

export interface ContextEvent {
  type: string
  seq: number
  data: { turn?: number | null; commandId?: string; sourceCommandId?: string; source?: { kind?: string }; content?: readonly { type: string; text?: string }[]; summary?: readonly { type: string; text?: string }[]; shadowedSeqs?: readonly number[] }
  surfaceOp?: 'append' | { op: 'replace'; startSeq: number; endSeq: number }
}
export interface ContextEventWindow { entries: readonly { event: ContextEvent }[] }
export function contextEventSource(session: SessionFace | undefined): ObservableSnapshot<ContextEventWindow> | undefined {
  return (session as { eventSource?: ObservableSnapshot<ContextEventWindow> } | undefined)?.eventSource
}

/** A standalone /compact transaction can be newer than turn/end. Fork before
 * its opening lock while it is unfinished; the first-send delta can then carry
 * a checkpoint that commits later. Automatic compaction stays in the busy turn. */
export function unfinishedCompactionCut(session: SessionFace | undefined): number | undefined {
  const entries = contextEventSource(session)?.getSnapshot().entries ?? []
  const last = entries.findLast(({ event }) => event.type === 'compaction/start' || event.type === 'compaction/end')?.event
  if (last?.type !== 'compaction/start' || last.data.turn !== null) return undefined
  // Exclude the correlated command row as well; a frozen command/run without
  // command/done would otherwise look permanently pending in inherited history.
  const command = last.data.sourceCommandId === undefined ? undefined : entries.findLast(({ event }) => event.type === 'command/run' && event.data.commandId === last.data.sourceCommandId)?.event
  return (command?.seq ?? last.seq) - 1
}

/** Published event window, shared by all supported hosts. Its last seed marker
 * is the child’s own fork cut (earlier markers can belong to ancestor forks). */
export function inheritedBoundarySource(session: SessionFace | undefined): ObservableSnapshot<number | undefined> | undefined {
  const source = contextEventSource(session)
  return source && {
    subscribe: notify => source.subscribe(notify),
    getSnapshot: () => {
      const seed = source.getSnapshot().entries.findLast(entry => entry.event.type === 'session/end-seed')
      return seed === undefined ? undefined : seed.event.seq - 1
    },
  }
}

/** Native root status includes approvals and questions, independently of running. */
export function sessionStatusSource(ctx: Context): ObservableSnapshot<ReadonlyMap<string, { running?: boolean; pendingInteraction?: unknown }>> | undefined {
  return (ctx.get('uiSession') as { sessionStatus?: ObservableSnapshot<ReadonlyMap<string, { running?: boolean; pendingInteraction?: unknown }>> } | undefined)?.sessionStatus
}

/** Durable conversation content; local submission echoes are never part of this face. */
export interface ChatSource {
  subscribe(fn: () => void): () => void
  getLegacy(): ConversationSnapshot | null
  getLastTurnEnd?(): { seq: number; reason: string } | undefined
  getCompletedReplySeqs?(): readonly number[]
}

export interface ChatReplySnapshot {
  legacy?: ConversationSnapshot
  timeline: { turnOrder: readonly number[]; turns: ReadonlyMap<number, { end?: { data: { reason: { kind: string } } } }> }
  locations: { getTurn(turn: number): readonly string[] }
  nodes: { get(key: string): { kind: string; data: { status?: string; finalNode?: { seq: number }; blocks?: readonly { kind: string; text?: string }[] } } | undefined }
}

export function completedReplySeqsOf(state: ChatReplySnapshot): number[] {
  const result: number[] = []
  for (const turn of state.timeline.turnOrder) {
    if (state.timeline.turns.get(turn)?.end?.data.reason.kind !== 'completed') continue
    for (const key of [...state.locations.getTurn(turn)].reverse()) {
      const node = state.nodes.get(key)
      if (node?.kind !== 'assistant-step') continue
      const data = node.data
      if (data.status === 'settled' && data.finalNode && data.blocks?.some(block => block.kind === 'text' && block.text?.trim()) && !data.blocks.some(block => block.kind === 'tool-call')) result.push(data.finalNode.seq)
      break
    }
  }
  return result
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
        getCompletedReplySeqs: () => completedReplySeqsOf(target.getSnapshot() as ChatReplySnapshot),
        getLastTurnEnd: () => {
          const state = target.getSnapshot() as { timeline?: { turnOrder: readonly number[]; turns: ReadonlyMap<number, { end?: { seq: number; data: { reason: { kind: string } } } }> } }
          const timeline = state.timeline
          if (!timeline) return undefined
          for (let index = timeline.turnOrder.length - 1; index >= 0; index--) {
            const end = timeline.turns.get(timeline.turnOrder[index]!)?.end
            if (end) return { seq: end.seq, reason: end.data.reason.kind }
          }
          return undefined
        },
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
