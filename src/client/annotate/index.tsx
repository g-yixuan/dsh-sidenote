/**
 * Workitem 02 — 划选注释：selection listener + numbered badges + annotation
 * editor + the composer「N 条注释」chip. Wiring only: one annotation store,
 * one selection controller, one overlay React root (appended to document.body
 * and marked `data-dsh-side-chat` so the listener excludes our own DOM), and
 * one `conversation.input.dock` slot entry. 全部 additive、页面级生命周期,
 * and every seam degrades to a logged no-op instead of crashing the host page.
 */
import { createRoot } from 'react-dom/client'
import type { Context } from '../../context-types.ts'
import { createAnnotationStore } from './model.ts'
import { createSelectionController } from './selection.ts'
import { AnnotateOverlay } from './overlay.tsx'
import { createAnnotationChip } from './chip.tsx'
import { syncAllDrafts } from './draft.ts'

export function registerAnnotations(ctx: Context): void {
  try {
    const store = createAnnotationStore()
    const controller = createSelectionController(() => ctx.sessions.list.getSnapshot().current ?? '')

    // The overlay root: toolbar + badges + highlight + editor.
    const host = document.createElement('div')
    host.dataset.dshSideChat = ''
    document.body.appendChild(host)
    createRoot(host).render(<AnnotateOverlay ctx={ctx} store={store} controller={controller} />)

    // 发送携带（受管草稿前缀块）: keep each session's composer draft headed by
    // its active annotations' quote block; the chip clears on the send edge.
    store.subscribe(() => { syncAllDrafts(ctx, store) })

    // The「N 条注释」chip: conversation.input.dock is the official composer
    // attachment seat; slots.inject waits for the shell's declaration (the
    // ui-conversation todo/queue docks register the same way).
    ctx.slots.inject('conversation.input.dock', () => {
      ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'dsh-side-chat-annotations',
        order: 10,
        registrant: 'dsh-side-chat',
      }, createAnnotationChip(store))
    })
  } catch (error) {
    console.error('[dsh-side-chat] annotate setup failed:', error)
  }
}
