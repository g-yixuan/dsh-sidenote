import { useLayoutEffect, useRef, useState } from 'react'
import { useLocaleTick } from '../locale-tick.ts'
import { t } from '../locales.ts'
import { sourceClip } from '../annotations/source.ts'
import type { SelectionPreview } from './selection.ts'
import css from './annotate.module.css'

/** Preserve Sidenote's selection surface while admitting the host quote action. */
export function SelectionToolbar(props: {
  snapshot: SelectionPreview
  sideChatAvailable: boolean
  addAvailable: boolean
  onAdd(): void
  onAsk(): void
  onQuote?: () => boolean
}) {
  useLocaleTick()
  const root = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useLayoutEffect(() => {
    const toolbar = root.current
    if (toolbar === null) return
    const place = (): void => {
      const rect = props.snapshot.range.getBoundingClientRect()
      const clip = sourceClip(props.snapshot.source)
      toolbar.style.maxWidth = `${Math.max(0, clip.right - clip.left - 16)}px`
      const { width, height } = toolbar.getBoundingClientRect()
      const left = Math.max(clip.left + width / 2 + 8, Math.min(clip.right - width / 2 - 8, rect.left + rect.width / 2))
      const below = rect.top < clip.top + Math.max(64, height + 10)
      toolbar.style.left = `${left}px`
      toolbar.style.top = `${below ? Math.max(clip.top + 4, Math.min(clip.bottom - height - 8, rect.bottom + 10)) : rect.top - 10}px`
      toolbar.classList.toggle(css.toolbarBelow!, below)
      toolbar.style.visibility = rect.bottom > clip.top && rect.top < clip.bottom ? 'visible' : 'hidden'
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(toolbar)
    return () => { observer.disconnect() }
  })
  if (!props.snapshot.source.body.isConnected || props.snapshot.range.getClientRects().length === 0) return null
  return (
    <div ref={root} className={css.toolbar} role="toolbar" aria-label={t('toolbarAria')}>
      {props.onQuote && <button type="button" className={css.toolbarButton} title={t('nativeQuoteHint')}
        onMouseDown={event => { event.preventDefault() }}
        onClick={event => { event.preventDefault(); event.stopPropagation(); setFailed(!props.onQuote!()) }}>
        {t('nativeQuote')}
      </button>}
      <button type="button" className={css.toolbarButton} disabled={!props.addAvailable}
        title={!props.addAvailable ? t('quoteWorkflowWaiting') : undefined}
        onMouseDown={event => { event.preventDefault() }}
        onClick={event => { event.preventDefault(); event.stopPropagation(); props.onAdd() }}>
        {t('addToConversation')}
      </button>
      {props.sideChatAvailable && <button type="button" className={css.toolbarButton}
        onMouseDown={event => { event.preventDefault() }}
        onClick={event => { event.preventDefault(); event.stopPropagation(); props.onAsk() }}>
        {t('askInSideChat')}
      </button>}
      {!props.addAvailable && <span className={css.toolbarStatus} role="status">{t('quoteWorkflowWaiting')}</span>}
      {failed && <span className={css.toolbarStatus} role="alert">{t('nativeQuoteFailed')}</span>}
    </div>
  )
}
