import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Context, SessionFace } from '../host/contracts.ts'
import { chatSourceOf, contextEventSource, inheritedBoundarySource, loadForkBoundary, loadInheritedContext } from '../host/chat.ts'
import { contextImageLoader } from '../host/attachments.ts'
import { transcriptOf } from '../chat/transcript.ts'
import { contextEntriesOf, contextHistory } from './context.ts'
import { effectiveContextNodes, loadMainlineSnapshot, snapshotEntriesFromText, snapshotEntriesOf, splitSnapshotPrefix } from './snapshot.ts'

const noop = () => () => {}

/** One read model for inherited history, live preview and the accepted snapshot.
 * Durable events win on reload; the accepted value bridges projection latency. */
export function useMainContext(ctx: Context, parentSessionId: string, childId: string | undefined, session: SessionFace | undefined, snapshotOnly: boolean, forkedMidTurn: boolean) {
  const boundarySource = useMemo(() => inheritedBoundarySource(session), [session])
  const inheritedBoundary = useSyncExternalStore(useCallback(notify => boundarySource?.subscribe(notify) ?? noop(), [boundarySource]), () => boundarySource?.getSnapshot())
  const boundarySeq = snapshotOnly ? -1 : inheritedBoundary
  const childChat = useMemo(() => chatSourceOf(ctx, childId ? ctx.sessions.binding(childId) : undefined), [ctx, childId, session])
  const legacy = useSyncExternalStore(useCallback(notify => childChat?.subscribe(notify) ?? noop(), [childChat]), () => childChat?.getLegacy() ?? null)
  const childEvents = useMemo(() => contextEventSource(session), [session])
  const childWindow = useSyncExternalStore(useCallback(notify => childEvents?.subscribe(notify) ?? noop(), [childEvents]), () => childEvents?.getSnapshot())
  const messages = useMemo(() => transcriptOf(legacy), [legacy])
  const parent = ctx.sessions.binding(parentSessionId)?.session
  const parentChat = useMemo(() => chatSourceOf(ctx, ctx.sessions.binding(parentSessionId)), [ctx, parentSessionId, parent])
  const parentLegacy = useSyncExternalStore(useCallback(notify => parentChat?.subscribe(notify) ?? noop(), [parentChat]), () => parentChat?.getLegacy() ?? null)
  const parentEvents = useMemo(() => contextEventSource(parent), [parent])
  const parentWindow = useSyncExternalStore(useCallback(notify => parentEvents?.subscribe(notify) ?? noop(), [parentEvents]), () => parentEvents?.getSnapshot())
  const sending = useRef<ReturnType<typeof splitSnapshotPrefix>>(null)
  const [accepted, setAccepted] = useState<ReturnType<typeof splitSnapshotPrefix>>(null)
  const pending = useRef(forkedMidTurn)
  pending.current = forkedMidTurn
  const firstSendPrefix = useCallback(async () => {
    if (!pending.current) return null
    if (!childId) throw new Error('侧聊上下文尚未就绪，请稍后重试')
    const boundary = snapshotOnly ? -1 : await loadForkBoundary(session)
    const text = await loadMainlineSnapshot(ctx, parentSessionId, boundary)
    sending.current = splitSnapshotPrefix(text)
    return text
  }, [ctx, parentSessionId, childId, session, snapshotOnly])
  const accept = useCallback(() => { if (sending.current) setAccepted(sending.current) }, [])
  const saved = useMemo(() => boundarySeq === undefined ? undefined : messages.filter(message => message.role === 'user' && (message.seq ?? -1) > (boundarySeq ?? -1)).map(message => splitSnapshotPrefix(message.text)).find(Boolean), [messages, boundarySeq]) ?? accepted
  const progress = useMemo(() => saved ? { entries: snapshotEntriesFromText(saved.snapshot), takenAt: saved.takenAt }
    : forkedMidTurn && boundarySeq !== undefined ? { entries: snapshotEntriesOf(effectiveContextNodes(parentLegacy?.nodes ?? [], parentWindow).nodes, parentLegacy?.partial, boundarySeq, parentLegacy?.runningCalls) } : undefined, [saved, forkedMidTurn, parentLegacy, parentWindow, boundarySeq])
  const history = useMemo(() => contextHistory(contextEntriesOf(effectiveContextNodes(legacy?.nodes ?? [], childWindow, boundarySeq ?? -1).nodes), progress?.entries ?? []), [legacy, childWindow, boundarySeq, progress])
  const loadContext = useCallback(async () => {
    if (!snapshotOnly) await loadForkBoundary(session)
    // One native event cache serves the context reader and the first-send path.
    await loadInheritedContext(session, 0)
  }, [session, snapshotOnly])
  const loadImage = useMemo(() => childId ? contextImageLoader(ctx, childId) : undefined, [ctx, childId])
  return { boundarySeq, childChat, messages, history, progress, loadContext, loadImage, firstSendPrefix, accept, contextPending: forkedMidTurn && !saved }
}
