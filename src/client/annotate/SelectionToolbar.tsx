import { useState } from 'react'
import { SelectionToolbarFrame } from '../annotations/SelectionToolbarFrame.tsx'
import { useLocaleTick } from '../locale-tick.ts'
import { t } from '../locales.ts'
import { sourceClip } from '../annotations/source.ts'
import type { SelectionSnapshot } from './selection.ts'
import css from '../annotations/selection.module.css'

/** Preserve Sidenote's selection surface while admitting the host quote action. */
export function SelectionToolbar(props: {
  snapshot: SelectionSnapshot
  sideChatAvailable: boolean
  addAvailable: boolean
  onAdd(): void
  onAsk(): void
  onQuote?: () => boolean
}) {
  useLocaleTick()
  const [failed, setFailed] = useState(false)
  if (!props.snapshot.source.body.isConnected || props.snapshot.range.getClientRects().length === 0) return null
  return (
    <SelectionToolbarFrame range={props.snapshot.range} view={props.snapshot.source.view} clip={() => sourceClip(props.snapshot.source)}>
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
    </SelectionToolbarFrame>
  )
}
