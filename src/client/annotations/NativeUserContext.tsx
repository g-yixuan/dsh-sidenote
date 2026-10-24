import { createElement, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Context, UiConversationLike } from '../host/contracts.ts'
import { conversationViewOf, mountUserBubbleAddon } from '../host/dom.ts'
import { IconChevronDownOutline14, IconListPenOutline16, IconShareOutline16 } from '../host/icons.ts'
import { flattenReflowContent, splitProtocolPrefix, splitSnapshotPrefix, type ProtocolPrefix } from './format.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './annotations.module.css'

interface HistoryNode { kind: string; seq: number; source?: { kind?: string }; content?: readonly { type: string; text?: string }[] }
interface UserProps {
  node: { data: { seq: number; content: readonly { type: string; text?: string }[] } }
  useChat<T>(select: (state: { legacy: { nodes: readonly HistoryNode[] } }) => T): T
}
interface Entry { component: ComponentType<UserProps>; options: { key?: string } }
const CONTEXT_NODE = 'dsh-sidenote-context'

/** Injected notices and their following human input are one admitted batch.
 * Project its reflows into that bubble without changing or resending history. */
export function injectedReflowPrefix(nodes: readonly HistoryNode[], seq: number): string {
  const prefixes: string[] = []
  for (let i = nodes.findIndex(node => node.seq === seq) - 1; i >= 0; i--) {
    const node = nodes[i]!
    if (node.kind !== 'context') break
    if (node.source?.kind !== 'dsh-sidenote') continue
    const text = (node.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
    const start = text.indexOf('<reflow ')
    if (start < 0) continue
    const prefix = splitProtocolPrefix(text.slice(start))
    if (prefix?.reflows.length) prefixes.unshift(text.slice(start, start + prefix.length))
  }
  return prefixes.join('\n\n')
}

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
  const [open, setOpen] = useState<{ pinned: boolean } | null>(null)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined }
  const leave = () => {
    clearTimer()
    if (!open?.pinned) timer.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement)) setOpen(null) }, 160)
  }
  const id = useId()
  const expanded = open !== null
  useEffect(() => clearTimer, [])
  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect()
      const view = conversationViewOf(anchor.current!).getBoundingClientRect()
      const left = Math.max(12, view.left + 12), right = Math.min(window.innerWidth - 12, view.right - 12)
      const top = Math.max(12, view.top + 12), bottom = Math.min(window.innerHeight - 12, view.bottom - 12)
      if (rect.bottom < top || rect.top > bottom) { setOpen(null); return }
      const width = Math.min(420, right - left)
      const above = rect.top - top - 8, below = bottom - rect.bottom - 8
      const preferAbove = above >= Math.min(280, window.innerHeight / 3) || above >= below
      setPosition({ width, left: Math.max(left, Math.min(rect.left, right - width)), maxHeight: Math.min(280, window.innerHeight / 3, preferAbove ? above : below), ...(preferAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [expanded])
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) { clearTimer(); setOpen(null) } }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); clearTimer(); setOpen(null); anchor.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [expanded])
  useLayoutEffect(() => { if (open?.pinned && document.activeElement === anchor.current) panel.current?.focus() }, [open?.pinned])
  return <span className={css.sentChipGroup}>
    {interactive ? <button ref={anchor} type="button" className={css.sentChip} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={id} onPointerEnter={event => {
      if (event.pointerType === 'touch') return
      clearTimer()
      if (!open && !document.querySelector('[data-sidenote-sent-preview][data-pinned]')) timer.current = setTimeout(() => { setOpen({ pinned: false }) }, 180)
    }} onPointerLeave={leave} onClick={() => { clearTimer(); setOpen(open?.pinned ? null : { pinned: true }) }}>
      {icon}<span>{label}</span><IconChevronDownOutline14 size={12} className={expanded ? css.sentChevronOpen : css.sentChevron} />
    </button> : <span className={css.sentChip}>{icon}<span>{label}</span></span>}
    {interactive && expanded && createPortal(<div ref={panel} id={id} role="dialog" tabIndex={-1} aria-label={label} className={`${css.contextPanel} ${css.sentPreview}`} style={position} data-sidenote-sent-preview data-pinned={open.pinned || undefined} data-sidenote-no-quote onPointerEnter={clearTimer} onPointerLeave={leave}>{children}</div>, document.body)}
  </span>
}

export function SentContext({ protocol, interactive = true }: { protocol: ProtocolPrefix; interactive?: boolean }) {
  useLocaleTick()
  return <span className={css.sentChips} data-dsh-sidenote-bubble data-sidenote-no-quote>
    {protocol.annotations.length > 0 && <ContextChip label={t('sentChipLabel', { n: protocol.annotations.length })} icon={<IconListPenOutline16 size={12} />} interactive={interactive}>
      <ul className={css.contextList}>{protocol.annotations.map(annotation => <li className={css.contextItem} key={annotation.id}>
        <span className={css.contextNumber}>{annotation.id}.</span><div className={css.contextContent}>
          <div className={css.contextLabel}>{t('selectedText')}</div><div className={css.contextText}>{annotation.quote}</div>
          {annotation.note && <><div className={css.contextLabel}>{t('userComment')}</div><div className={css.contextText}>{annotation.note}</div></>}
        </div>
      </li>)}</ul>
    </ContextChip>}
    {protocol.reflows.length > 0 && <ContextChip label={t('reflowBubbleLabel')} icon={<IconShareOutline16 size={12} />} interactive={interactive}>
      <ul className={css.contextList}>{protocol.reflows.map((reflow, index) => <li className={css.contextItem} key={index}>
        <span className={css.contextNumber}>{index + 1}.</span><div className={css.contextContent}><div className={css.contextSource}>{reflow.source}</div><div className={css.contextText}>{flattenReflowContent(reflow.content)}</div></div>
      </li>)}</ul>
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
            const nodes = props.useChat(state => state.legacy.nodes)
            const injected = injectedReflowPrefix(nodes, props.node.data.seq)
            const blocks = props.node.data.content
            const at = blocks.findIndex(block => block.type === 'text')
            const text = blocks[at]?.text ?? ''
            const snapshot = splitSnapshotPrefix(text)
            const afterSnapshot = (injected ? injected + '\n\n' : '') + (snapshot?.rest ?? text)
            const protocol = nativeText ? null : splitProtocolPrefix(afterSnapshot)
            if (!snapshot && !protocol && !injected) return createElement(Original, props)
            const body = protocol ? afterSnapshot.slice(protocol.length).trimStart() : afterSnapshot
            // Retain the native bubble for an annotation-only message; this
            // presentation-only word joiner never enters the durable content.
            const displayText = body || (protocol ? '\u2060' : '')
            const content = at < 0 ? [...blocks, { type: 'text', text: displayText }] : blocks.map((block, index) => index === at ? { ...block, text: displayText } : block)
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
