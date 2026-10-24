import { createContext, createElement, useCallback, useContext, useMemo, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type { Context, SessionReference } from '../host/contracts.ts'
import { transcriptOf, type ChatMessage } from '../chat/transcript.ts'
import { createFoldStore } from '../chat/viewState.ts'
import { pairQuestions } from './model.ts'
import type { ReflowStore } from '../reflow.ts'
import { t } from '../locales.ts'
import css from './sidechat.module.css'

export interface SideConversation {
  sessionId: string
  parentSessionId: string
  title: string
  boundarySeq?: number
  reflow: ReflowStore
}
export interface ConversationRendererProps {
  SessionProvider: ComponentType<{ session: SessionReference; children?: ReactNode }>
  renderSlot(name: 'sidenote.conversation', owner: Record<string, never>): ReactNode
}
export type RenderConversation = (reference: SessionReference, side: SideConversation) => ReactNode
const SideContext = createContext<SideConversation | null>(null)
export function renderSideConversation(props: ConversationRendererProps, reference: SessionReference, side: SideConversation): ReactNode {
  return <SideContext.Provider value={side}><props.SessionProvider session={reference}>{props.renderSlot('sidenote.conversation', {})}</props.SessionProvider></SideContext.Provider>
}

interface ContentProps {
  renderFactorySlot(name: 'conversation.content', owner: { variant: 'embedded'; phase: 'active'; hero: false }, options: { slots: { views: typeof ChatView } }): ReactNode
}
function ChatView(props: { renderSlot(name: 'conversation.session', owner: { view: 'chat' }): ReactNode }) {
  return props.renderSlot('conversation.session', { view: 'chat' })
}
function Content(props: ContentProps) {
  return props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: ChatView } })
}

/** Only completed, fork-local final answers are eligible for reflow. */
export function finalReplies(messages: readonly ChatMessage[], boundarySeq = -1, completed?: ReadonlySet<number>): ChatMessage[] {
  const replies: ChatMessage[] = []
  let final: ChatMessage | undefined
  const finish = (): void => { if (final && !final.streaming && !final.interrupted && final.text.trim() !== '' && (completed === undefined || (final.seq !== undefined && completed.has(final.seq)))) replies.push(final) }
  for (const message of messages) {
    if ((message.seq ?? Infinity) <= boundarySeq) continue
    if (message.role === 'user') { finish(); final = undefined }
    else if (message.role === 'assistant') final = message
    else if (message.role === 'error') final = undefined
  }
  finish()
  return replies
}
export function isReplyAdded(side: SideConversation, message: ChatMessage, question?: string): boolean {
  const key = `${side.sessionId}:${message.seq ?? message.key}`
  return side.reflow.list(side.parentSessionId).some(item => item.sourceKey === key || (item.sourceKey === undefined && item.sideTitle === side.title && item.text === message.text && item.question === question))
}
export function addReply(side: SideConversation, message: ChatMessage, question?: string): void {
  if (!isReplyAdded(side, message, question)) {
    side.reflow.add(side.parentSessionId, side.title, message.text, question, `${side.sessionId}:${message.seq ?? message.key}`)
  }
}

interface ActionProps { seq: number; turn: { end?: { data: { reason: { kind: string } } } }; useChat<T>(select: (state: { legacy?: Parameters<typeof transcriptOf>[0] }) => T): T }
function ReflowAction(props: ActionProps) {
  const side = useContext(SideContext)
  const legacy = props.useChat(state => state.legacy)
  if (side === null || props.turn.end?.data.reason.kind !== 'completed') return null
  return <ReplyAction side={side} messages={transcriptOf(legacy ?? null)} seq={props.seq} />
}
function ReplyAction({ side, messages, seq }: { side: SideConversation; messages: ChatMessage[]; seq: number }) {
  useSyncExternalStore(side.reflow.subscribe, side.reflow.getSnapshot)
  const reply = finalReplies(messages, side.boundarySeq).find(message => message.seq === seq)
  if (!reply) return null
  const question = pairQuestions(messages).get(reply.key)
  const added = isReplyAdded(side, reply, question)
  return <button type="button" className={css.nativeAction} aria-pressed={added} disabled={added} onClick={() => { addReply(side, reply, question) }}>{t(added ? 'reflowDone' : 'reflowToMain')}</button>
}

interface Entry { kind: 'node' | 'group'; key: string }
interface NodeSnapshot { anchorSeq: number; kind: string; location?: { turn?: { start?: { seq: number } } } }
interface GroupedView { entries: readonly Entry[]; groupSource(key: string): { getSnapshot(): { members: readonly Entry[] } | undefined } }
interface ViewSnapshot { views: { grouped(name: string): GroupedView | undefined } }
interface ViewProps {
  useChat<T>(select: (state: { nodes: { get(key: string): NodeSnapshot | undefined } }) => T): T
  useConversation<T>(select: (state: ViewSnapshot) => T): T
}
function HistoryView({ Original, props, side }: { Original: ComponentType<ViewProps>; props: ViewProps; side: SideConversation }) {
  const fold = useMemo(() => createFoldStore(`dsh-sidenote:fold:v1:${side.sessionId}`), [side.sessionId])
  useSyncExternalStore(fold.subscribe, fold.getSnapshot)
  const nodes = props.useChat(state => state.nodes)
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
  const inherited = entries.filter(isInherited)
  const expanded = fold.isOpen('inherited')
  const visible = expanded ? entries : entries.filter(entry => !isInherited(entry))
  const projected = { ...snapshot, views: { ...snapshot.views, grouped: (name: string) => name === 'chat' && groups ? { ...groups, entries: visible } : snapshot.views.grouped(name) } }
  const useProjected = useCallback(<T,>(selector: (state: ViewSnapshot) => T): T => selector(projected), [projected])
  return <>
    {inherited.length > 0 && <button type="button" className={css.historyToggle} aria-expanded={expanded} onClick={() => { fold.toggle('inherited') }}>{t('inheritedLabel', { n: inherited.length })}</button>}
    {createElement(Original, { ...props, useConversation: useProjected })}
  </>
}

/** Both admitted hosts publish the native chat View; only 0.2.1 adds a Flow slot. */
function registerInheritedHistory(ctx: Context): void {
  type ViewEntry = { component: ComponentType<ViewProps>; options: { id?: string; priority?: number } }
  const slots = ctx.slots as Context['slots'] & { entries(name: string): readonly ViewEntry[]; subscribe(name: string, notify: () => void): () => void }
  ctx.slots.inject('conversation.view', () => {
    const patched = new Map<ViewEntry, { original: ComponentType<ViewProps>; wrapped: ComponentType<ViewProps> }>()
    const patch = (): void => {
      for (const entry of slots.entries('conversation.view')) {
        if (entry.options.id !== 'chat' || entry.options.priority === 10000 || patched.has(entry)) continue
        const Original = entry.component
        function ScopedView(props: ViewProps) {
          const side = useContext(SideContext)
          return side === null ? createElement(Original, props) : <HistoryView Original={Original} props={props} side={side} />
        }
        entry.component = ScopedView
        patched.set(entry, { original: Original, wrapped: ScopedView })
      }
    }
    patch()
    const off = slots.subscribe('conversation.view', patch)
    // Registration notifications batch by microtask. Invalidate the outlet,
    // then remove the wake entry immediately so it never becomes a View tab.
    const refresh = (): void => {
      if (slots.entries('conversation.view').length > 0) ctx.slots.register({ name: 'conversation.view', id: 'chat', priority: 10000 }, () => null)()
    }
    refresh()
    return () => { off(); for (const [entry, value] of patched) if (entry.component === value.wrapped) entry.component = value.original; refresh() }
  })
}

/** Preserve existing annotation anchors while the host owns the complete message renderer. */
function registerAssistantAnchors(ctx: Context): void {
  interface AssistantProps { node: { anchorSeq: number; data: { status: string; finalNode?: { seq: number } } } }
  type AssistantEntry = { component: ComponentType<AssistantProps>; options: { key?: string } }
  const slots = ctx.slots as Context['slots'] & { entries(name: string): readonly AssistantEntry[]; subscribe(name: string, notify: () => void): () => void }
  ctx.slots.inject('conversation.chat.node', () => {
    const patched = new Map<AssistantEntry, { original: ComponentType<AssistantProps>; wrapped: ComponentType<AssistantProps> }>()
    const patch = (): void => {
      for (const entry of slots.entries('conversation.chat.node')) {
        if (entry.options.key !== 'assistant-step' || patched.has(entry)) continue
        const Original = entry.component
        function AnchoredAssistant(props: AssistantProps) {
          const side = useContext(SideContext)
          const content = createElement(Original, props)
          if (!side) return content
          return <div data-sidenote-quote-body data-sidenote-message-role="assistant" data-sidenote-message-key={`a:${props.node.data.finalNode?.seq ?? props.node.anchorSeq}`} data-sidenote-streaming={props.node.data.status === 'running' ? 'true' : 'false'}>{content}</div>
        }
        entry.component = AnchoredAssistant
        patched.set(entry, { original: Original, wrapped: AnchoredAssistant })
      }
    }
    patch()
    const off = slots.subscribe('conversation.chat.node', patch)
    return () => { off(); for (const [entry, value] of patched) if (entry.component === value.wrapped) entry.component = value.original }
  })
}
export function registerNativeConversation(ctx: Context): void {
  ctx.slots.inject('sidenote.conversation', () => ctx.slots.register({ name: 'sidenote.conversation' }, Content))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'dsh-sidenote-reflow', order: 20 }, ReflowAction))
  registerInheritedHistory(ctx)
  registerAssistantAnchors(ctx)
}
