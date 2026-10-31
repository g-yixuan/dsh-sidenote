import { createContext, createElement, useContext, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type { Context, SessionReference } from '../host/contracts.ts'
import { transcriptOf, type ChatMessage } from '../chat/transcript.ts'
import { completedReplySeqsOf, type ChatReplySnapshot } from '../host/chat.ts'
import { IconCheckOutline16 } from '../host/icons.ts'
import { InheritedContext, type InheritedContextData } from './InheritedContext.tsx'
import { SavedConversation, HistoryView, type ViewProps } from './SavedConversation.tsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { pairQuestions } from './model.ts'
import type { ReflowStore } from '../reflow.ts'
import { t } from '../locales.ts'
import css from './sidechat.module.css'

export interface SideConversation extends InheritedContextData {
  parentSessionId: string
  title: string
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
  const side = useContext(SideContext)!
  return <div className={css.chatView}>
    <InheritedContext context={side} />
    {props.renderSlot('conversation.session', { view: 'chat' })}
  </div>
}
function Content(props: ContentProps) {
  return props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: ChatView } })
}

/** Only completed, fork-local final answers are eligible for reflow. */
export function finalReplies(messages: readonly ChatMessage[], boundarySeq: number | undefined, completed?: ReadonlySet<number>): ChatMessage[] {
  if (boundarySeq === undefined) return []
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
  if (side.boundarySeq === undefined || message.seq === undefined || message.seq <= side.boundarySeq) return
  if (!isReplyAdded(side, message, question)) {
    side.reflow.add(side.parentSessionId, side.title, message.text, question, `${side.sessionId}:${message.seq ?? message.key}`)
  }
}

interface ActionProps { messageId: string; useChat<T>(select: (state: ChatReplySnapshot) => T): T }
function ReflowAction(props: ActionProps) {
  const side = useContext(SideContext)
  const state = props.useChat(state => state)
  const node = state.legacy?.nodes.find(node => (node as { messageId?: string }).messageId === props.messageId) as { seq: number } | undefined
  if (side === null || !node || !completedReplySeqsOf(state).includes(node.seq)) return null
  return <ReplyAction side={side} messages={transcriptOf(state.legacy ?? null)} seq={node.seq} />
}
function ReplyAction({ side, messages, seq }: { side: SideConversation; messages: ChatMessage[]; seq: number }) {
  useSyncExternalStore(side.reflow.subscribe, side.reflow.getSnapshot)
  const reply = finalReplies(messages, side.boundarySeq).find(message => message.seq === seq)
  if (!reply) return null
  const question = pairQuestions(messages).get(reply.key)
  const added = isReplyAdded(side, reply, question)
  const label = t(added ? 'reflowDone' : 'reflowToMain')
  return <Tooltip label={label} side="top"><button type="button" className={css.reflowAction} aria-label={label} aria-pressed={added} disabled={added} onClick={() => { addReply(side, reply, question) }}>
    {added ? <IconCheckOutline16 size={18} /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M20 12H8m5-5-5 5 5 5" /></svg>}
  </button></Tooltip>
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
          return side === null ? <SavedConversation ctx={ctx} Original={Original} props={props} /> : <HistoryView Original={Original} props={props} side={side} />
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
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'dsh-sidenote-reflow', order: 100 }, ReflowAction))
  registerInheritedHistory(ctx)
  registerAssistantAnchors(ctx)
}
