import { createElement, useId, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Context, UiConversationLike } from '../host/contracts.ts'
import { mountUserBubbleAddon } from '../host/dom.ts'
import { IconChevronDownOutline14, IconListPenOutline16, IconShareOutline16 } from '../host/icons.ts'
import { flattenReflowContent, splitProtocolPrefix, splitSnapshotPrefix, type ProtocolPrefix } from './format.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './annotations.module.css'

interface UserProps { node: { data: { content: readonly { type: string; text?: string }[] } } }
interface Entry { component: ComponentType<UserProps>; options: { key?: string } }
const CONTEXT_NODE = 'dsh-sidenote-context'

/** One prefix node leaves the body, @ references and attachments to the host. */
export const sentContextRule = {
  id: CONTEXT_NODE,
  order: 0,
  match(text: string, from: number) {
    const snapshot = splitSnapshotPrefix(text)
    const start = snapshot ? text.length - snapshot.rest.length : 0
    if (from > start) return undefined
    const protocol = splitProtocolPrefix(text.slice(start))
    return protocol ? { id: CONTEXT_NODE, start, end: start + protocol.length, data: protocol } : undefined
  },
}

function ContextChip({ label, icon, children, interactive }: { label: string; icon: ReactNode; children: ReactNode; interactive: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <span className={css.sentChipGroup}>
    {interactive ? <button type="button" className={css.sentChip} aria-expanded={expanded} aria-controls={id} onClick={() => { setExpanded(open => !open) }}>
      {icon}<span>{label}</span><IconChevronDownOutline14 size={12} className={expanded ? css.sentChevronOpen : css.sentChevron} />
    </button> : <span className={css.sentChip}>{icon}<span>{label}</span></span>}
    {interactive && <span id={id} className={css.sentPreview} hidden={!expanded}>{children}</span>}
  </span>
}

export function SentContext({ protocol, interactive = true }: { protocol: ProtocolPrefix; interactive?: boolean }) {
  useLocaleTick()
  return <span className={css.sentChips} data-dsh-sidenote-bubble data-sidenote-no-quote>
    {protocol.annotations.length > 0 && <ContextChip label={t('sentChipLabel', { n: protocol.annotations.length })} icon={<IconListPenOutline16 size={12} />} interactive={interactive}>
      {protocol.annotations.map(annotation => <span className={css.sentItem} key={annotation.id}><span className={css.sentQuote}>{annotation.quote}</span>{annotation.note && <span className={css.sentNote}>{annotation.note}</span>}</span>)}
    </ContextChip>}
    {protocol.reflows.length > 0 && <ContextChip label={t('reflowBubbleLabel')} icon={<IconShareOutline16 size={12} />} interactive={interactive}>
      {protocol.reflows.map((reflow, index) => <span className={css.sentItem} key={index}><span className={css.sentSource}>{reflow.source}</span><span>{flattenReflowContent(reflow.content)}</span></span>)}
    </ContextChip>}
  </span>
}

function LegacyContext({ Original, props, protocol }: { Original: ComponentType<UserProps>; props: UserProps; protocol: ProtocolPrefix }) {
  const root = useRef<HTMLDivElement>(null)
  const [seat] = useState(() => document.createElement('span'))
  useLayoutEffect(() => root.current ? mountUserBubbleAddon(root.current, seat) : undefined, [seat, props.node])
  return <div ref={root} className={css.userContextHost}>{createElement(Original, props)}{createPortal(<SentContext protocol={protocol} />, seat)}</div>
}

/** Keep contextual chips inside the native bubble on both main and side chat.
 * Only the progress snapshot remains outside its owning user message. */
export function registerUserContext(ctx: Context): void {
  ctx.inject(['uiConversation'], () => {
    const ui = ctx.get('uiConversation') as UiConversationLike
    const nativeText = ui.userText !== undefined
    if (nativeText) {
      ctx.slots.inject('conversation.user.text.node', () => {
        const offRenderer = ctx.slots.register({ name: 'conversation.user.text.node', key: CONTEXT_NODE }, (props: { node: { data: ProtocolPrefix }; interactive: boolean }) => <SentContext protocol={props.node.data} interactive={props.interactive} />)
        const offRule = ui.userText!.register(sentContextRule)
        return () => { offRule(); offRenderer() }
      })
    }
    const slots = ctx.slots as Context['slots'] & { entries(name: string): readonly Entry[]; subscribe(name: string, notify: () => void): () => void }
    ctx.slots.inject('conversation.chat.node', () => {
      const patched = new Map<Entry, { original: ComponentType<UserProps>; wrapped: ComponentType<UserProps> }>()
      const patch = (): void => {
        for (const entry of slots.entries('conversation.chat.node')) {
          if (!['user', 'steering'].includes(entry.options.key ?? '') || patched.has(entry)) continue
          const Original = entry.component
          function ContextUser(props: UserProps) {
            const blocks = props.node.data.content
            const at = blocks.findIndex(block => block.type === 'text')
            const text = blocks[at]?.text ?? ''
            const snapshot = splitSnapshotPrefix(text)
            const afterSnapshot = snapshot?.rest ?? text
            const protocol = nativeText ? null : splitProtocolPrefix(afterSnapshot)
            if (!snapshot && !protocol) return createElement(Original, props)
            const body = protocol ? afterSnapshot.slice(protocol.length).trimStart() : afterSnapshot
            // Retain the native bubble for an annotation-only message; this
            // presentation-only word joiner never enters the durable content.
            const content = blocks.map((block, index) => index === at ? { ...block, text: body || (protocol ? '\u2060' : '') } : block)
            const projected = { ...props, node: { ...props.node, data: { ...props.node.data, content } } }
            return <>
              {snapshot && <details className={css.sentContext} data-sidenote-progress-snapshot><summary>{t('snapshotContext')}</summary><pre>{snapshot.snapshot}</pre></details>}
              {protocol ? <LegacyContext Original={Original} props={projected} protocol={protocol} /> : createElement(Original, projected)}
            </>
          }
          entry.component = ContextUser
          patched.set(entry, { original: Original, wrapped: ContextUser })
        }
      }
      patch()
      const off = slots.subscribe('conversation.chat.node', patch)
      return () => { off(); for (const [entry, value] of patched) if (entry.component === value.wrapped) entry.component = value.original }
    })
  })
}
