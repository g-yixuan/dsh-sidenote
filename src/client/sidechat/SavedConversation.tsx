import { createElement, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '../host/contracts.ts'
import { chatSourceOf, contextEventSource, loadInheritedContext } from '../host/chat.ts'
import { contextImageLoader } from '../host/attachments.ts'
import { contextEntriesOf, contextHistory, savedContextOf } from './context.ts'
import { effectiveContextNodes, snapshotEntriesFromText, splitSnapshotPrefix } from './snapshot.ts'
import { InheritedContext, type InheritedContextData } from './InheritedContext.tsx'
import { t } from '../locales.ts'
import css from './sidechat.module.css'

interface Entry { kind: 'node' | 'group'; key: string }
interface NodeSnapshot { data?: { content?: readonly { type: string; text?: string }[] }; anchorSeq: number; kind: string; location?: { turn?: { start?: { seq: number } } } }
interface GroupedView { entries: readonly Entry[]; groupSource(key: string): { getSnapshot(): { members: readonly Entry[] } | undefined } }
interface ViewSnapshot { views: { grouped(name: string): GroupedView | undefined } }
interface NavigationItem { anchorKey: string; prompt: string }
interface ChatState { nodes: { get(key: string): NodeSnapshot | undefined }; navigation?: { items(): readonly NavigationItem[] } }
export interface ViewProps {
  sessionId: string
  useChat<T>(select: (state: ChatState) => T): T
  useConversation<T>(select: (state: ViewSnapshot) => T): T
}
export function HistoryView({ Original, props, side }: { Original: ComponentType<ViewProps>; props: ViewProps; side: Pick<InheritedContextData, 'boundarySeq'> }) {
  const chat = props.useChat(state => state)
  const nodes = chat.nodes
  const snapshot = props.useConversation(state => state)
  const groups = snapshot.views.grouped('chat')
  const entries = groups?.entries ?? []
  const isInherited = (entry: Entry): boolean => {
    if (entry.kind === 'node') {
      const node = nodes.get(entry.key)
      // A footer is anchored after turn/end, beyond the last legacy message.
      // Classify it by its owning turn, including stopped or failed turns.
      const seq = node?.kind === 'turn-tail' ? node.location?.turn?.start?.seq ?? node.anchorSeq : node?.anchorSeq
      return seq !== undefined && seq <= (side.boundarySeq ?? -1)
    }
    const members = groups?.groupSource(entry.key).getSnapshot()?.members ?? []
    return members.length > 0 && members.every(isInherited)
  }
  // The native conversation owns side messages only. Context has its own
  // stable React region, including when the native session is still blank.
  const visible = entries.filter(entry => !isInherited(entry))
  const projected = { ...snapshot, views: { ...snapshot.views, grouped: (name: string) => name === 'chat' && groups ? { ...groups, entries: visible } : snapshot.views.grouped(name) } }
  const useProjected = useCallback(<T,>(selector: (state: ViewSnapshot) => T): T => selector(projected), [projected])
  // The main-view rail must target only visible local rows, and its prompt
  // preview must not expose the protocol stripped from the corresponding bubble.
  const navigation = chat.navigation?.items().filter(item => !isInherited({ kind: 'node', key: item.anchorKey })).map(item => {
    const text = nodes.get(item.anchorKey)?.data?.content?.find(block => block.type === 'text')?.text
    const saved = text ? splitSnapshotPrefix(text) : null
    return saved ? { ...item, prompt: saved.rest.slice(0, 200) } : item
  })
  const projectedChat = navigation ? { ...chat, navigation: { ...chat.navigation, items: () => navigation } } : chat
  const useProjectedChat = useCallback(<T,>(selector: (state: ChatState) => T): T => selector(projectedChat), [projectedChat])
  return createElement(Original, { ...props, useConversation: useProjected, useChat: useProjectedChat })
}


/** Recover saved side chats from their durable first-send marker. No local tab
 * state or dependency on a still-open parent is needed after promotion. */
export function SavedConversation({ ctx, Original, props }: { ctx: Context; Original: ComponentType<ViewProps>; props: ViewProps }) {
  const binding = ctx.sessions.binding(props.sessionId)
  const session = binding?.session
  const chat = useMemo(() => chatSourceOf(ctx, binding), [ctx, session])
  const legacy = useSyncExternalStore(useCallback(notify => chat?.subscribe(notify) ?? (() => {}), [chat]), () => chat?.getLegacy())
  const source = useMemo(() => contextEventSource(session), [session])
  const window = useSyncExternalStore(useCallback(notify => source?.subscribe(notify) ?? (() => {}), [source]), () => source?.getSnapshot())
  const saved = useMemo(() => savedContextOf(legacy?.nodes ?? [], window?.entries ?? [], window?.hasMore), [legacy, window])
  const catalog = useSyncExternalStore(useCallback(notify => ctx.sessions.list.subscribe(notify), [ctx]), () => ctx.sessions.list.getSnapshot())
  const parentId = (catalog.byId?.[props.sessionId] as { parentId?: string } | undefined)?.parentId
  const seeded = !!parentId || window?.entries.some(({ event }) => event.type === 'session/end-seed') === true
  const [error, setError] = useState<string>()
  const loadContext = useCallback(() => loadInheritedContext(session, 0), [session])
  // A promoted transcript may be paged beyond its first input. Its final seed
  // identifies a copied history; reuse the host cache to discover that input.
  useEffect(() => {
    if (!seeded || saved) return
    let active = true
    void loadContext().catch(reason => { if (active) setError(String(reason instanceof Error ? reason.message : reason)) })
    return () => { active = false }
  }, [seeded, !!saved, loadContext])
  const progress = useMemo(() => saved ? { entries: snapshotEntriesFromText(saved.snapshot), takenAt: saved.takenAt } : undefined, [saved])
  const history = useMemo(() => contextHistory(contextEntriesOf(effectiveContextNodes(legacy?.nodes ?? [], window, saved?.boundarySeq ?? -1).nodes), progress?.entries ?? []), [legacy, window, saved, progress])
  const loadImage = useMemo(() => contextImageLoader(ctx, props.sessionId), [ctx, props.sessionId])
  if (!saved) return <>{error && <div role="alert" className={css.errorRow}>{error}<button type="button" className={css.nativeAction} onClick={() => { void loadContext().then(() => setError(undefined), reason => setError(String(reason))) }}>{t('contextRetry')}</button></div>}{createElement(Original, props)}</>
  const context = { sessionId: props.sessionId, boundarySeq: saved.boundarySeq, history, progress, loadContext, loadImage }
  return <div className={css.chatView} data-sidenote-saved-context>
    <InheritedContext context={context} />
    <HistoryView Original={Original} props={props} side={context} />
  </div>
}
