import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Context, SessionFace } from '../host/contracts.ts'
import { chatSourceOf, contextEventSource, inheritedBoundarySource, loadForkBoundary, loadInheritedContext } from '../host/chat.ts'
import { contextImageLoader } from '../host/attachments.ts'
import { transcriptOf } from '../chat/transcript.ts'
import { contextEntriesOf, contextHistory } from './context.ts'
import { snapshotImages, type ImageBlock } from '../../snapshotProtocol.ts'
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
  const sending = useRef<ReturnType<typeof splitSnapshotPrefix>>(null)
  const [accepted, setAccepted] = useState<(NonNullable<ReturnType<typeof splitSnapshotPrefix>> & { content?: readonly ImageBlock[] }) | null>(null)
  const pending = useRef(forkedMidTurn)
  pending.current = forkedMidTurn && !accepted
  const firstSendPrefix = useCallback(async () => {
    if (!pending.current) return null
    if (!childId) throw new Error('侧聊上下文尚未就绪，请稍后重试')
    const boundary = snapshotOnly ? -1 : await loadForkBoundary(session)
    const text = await loadMainlineSnapshot(ctx, parentSessionId, boundary)
    sending.current = splitSnapshotPrefix(text)
    const attachments = snapshotImages(text)
    return { text, ...(attachments.length ? { images: { sessionId: parentSessionId, attachments } } : {}) }
  }, [ctx, parentSessionId, childId, session, snapshotOnly])
  const accept = useCallback(() => { if (sending.current) setAccepted(sending.current) }, [])
  const saved = useMemo(() => boundarySeq === undefined ? undefined : (legacy?.nodes ?? []).flatMap(value => {
    const node = value as { kind: string; seq: number; content?: readonly { type: string; text?: string; attachment?: unknown }[] }
    if (!['user', 'steering'].includes(node.kind) || node.seq <= boundarySeq) return []
    const prefix = splitSnapshotPrefix(node.content?.find(block => block.type === 'text')?.text ?? '')
    return prefix ? [{ ...prefix, content: node.content }] : []
  })[0], [legacy, boundarySeq]) ?? accepted
  const preview = forkedMidTurn && !saved
  const parent = preview ? ctx.sessions.binding(parentSessionId)?.session : undefined
  const parentChat = useMemo(() => preview ? chatSourceOf(ctx, ctx.sessions.binding(parentSessionId)) : undefined, [ctx, parentSessionId, parent, preview])
  const parentLegacy = useSyncExternalStore(useCallback(notify => parentChat?.subscribe(notify) ?? noop(), [parentChat]), () => parentChat?.getLegacy() ?? null)
  const parentEvents = useMemo(() => contextEventSource(parent), [parent])
  const parentWindow = useSyncExternalStore(useCallback(notify => parentEvents?.subscribe(notify) ?? noop(), [parentEvents]), () => parentEvents?.getSnapshot())
  const progress = useMemo(() => saved ? { entries: snapshotEntriesFromText(saved.snapshot, saved.content), takenAt: saved.takenAt }
    : forkedMidTurn && boundarySeq !== undefined ? { entries: snapshotEntriesOf(effectiveContextNodes(parentLegacy?.nodes ?? [], parentWindow).nodes, parentLegacy?.partial, boundarySeq, parentLegacy?.runningCalls) } : undefined, [saved, forkedMidTurn, parentLegacy, parentWindow, boundarySeq])
  const history = useMemo(() => contextHistory(contextEntriesOf(effectiveContextNodes(legacy?.nodes ?? [], childWindow, boundarySeq ?? -1).nodes), progress?.entries ?? []), [legacy, childWindow, boundarySeq, progress])
  const loadContext = useCallback(async () => {
    if (!snapshotOnly) await loadForkBoundary(session)
    // One native event cache serves the context reader and the first-send path.
    await loadInheritedContext(session, 0)
  }, [session, snapshotOnly])
  const loadImage = useMemo(() => childId ? contextImageLoader(ctx, childId) : undefined, [ctx, childId])
  const loadProgressImage = useMemo(() => preview ? contextImageLoader(ctx, parentSessionId) : loadImage, [ctx, parentSessionId, preview, loadImage])
  return { boundarySeq, childChat, messages, history, progress, loadContext, loadImage, loadProgressImage, firstSendPrefix, accept, contextPending: forkedMidTurn && !saved }
}
