import { createElement, type ComponentType } from 'react'
import type { Context } from '../host/contracts.ts'
import { flattenReflowContent, splitProtocolPrefix, splitSnapshotPrefix } from './format.ts'
import { t } from '../locales.ts'
import css from './annotations.module.css'

interface UserProps { node: { data: { content: readonly { type: string; text?: string }[] } } }
interface Entry { component: ComponentType<UserProps>; options: { key?: string } }

/** Present controlled context without editing React-owned DOM or durable data.
 * The host still owns the user bubble, images, reference nodes and actions. */
export function registerUserContext(ctx: Context): void {
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
          const protocol = splitProtocolPrefix(afterSnapshot)
          if (!snapshot && !protocol) return createElement(Original, props)
          const content = blocks.map((block, index) => index === at ? { ...block, text: afterSnapshot.slice(protocol?.length ?? 0).trimStart() } : block)
          return <>
            {snapshot && <details className={css.sentContext} data-sidenote-progress-snapshot><summary>{t('snapshotContext')}</summary><pre>{snapshot.snapshot}</pre></details>}
            {protocol && <div data-dsh-sidenote-bubble>
              {protocol.annotations.length > 0 && <details className={css.sentContext}><summary>{t('sentChipLabel', { n: protocol.annotations.length })}</summary>{protocol.annotations.map(annotation => <blockquote key={annotation.id}>{annotation.quote}{annotation.note && <p>{annotation.note}</p>}</blockquote>)}</details>}
              {protocol.reflows.length > 0 && <details className={css.sentContext}><summary>{t('reflowBubbleLabel')}</summary>{protocol.reflows.map((reflow, index) => <blockquote key={index}>{reflow.source}<pre>{flattenReflowContent(reflow.content)}</pre></blockquote>)}</details>}
            </div>}
            {createElement(Original, { ...props, node: { ...props.node, data: { ...props.node.data, content } } })}
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
}
