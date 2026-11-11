import { useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '../host/contracts.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { quoteClipOf } from '../host/dom.ts'
import { probeInput } from '../host/input.ts'
import { hostDiagnostics } from '../host/probes.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import { SelectionToolbarFrame } from '../annotations/SelectionToolbarFrame.tsx'
import { AnnotationBoundary } from '../annotations/boundary.tsx'
import { useLocaleTick } from '../locale-tick.ts'
import { t } from '../locales.ts'
import { captureDocumentSelection, type DocumentSelection } from './selection.ts'
import css from '../annotations/selection.module.css'

function DocumentSelectionToolbar({ ctx, store }: { ctx: Context; store: AnnotationStore }) {
  useLocaleTick()
  const [selection, setSelection] = useState<DocumentSelection | null>(null)
  const [notice, setNotice] = useState('')
  const diagnostics = hostDiagnostics(ctx)
  const capabilities = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot)
  useEffect(() => {
    let captured: DocumentSelection | null = null
    const capture = () => {
      const next = captureDocumentSelection(currentSessionIdOf(ctx))
      captured = next
      setSelection(previous => previous?.body === next?.body && previous?.address === next?.address
        && previous?.sessionId === next?.sessionId && previous?.text === next?.text
        && previous?.range.startContainer === next?.range.startContainer && previous?.range.startOffset === next?.range.startOffset
        && previous?.range.endContainer === next?.range.endContainer && previous?.range.endOffset === next?.range.endOffset ? previous : next)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && captureDocumentSelection(currentSessionIdOf(ctx))) { window.getSelection()?.removeAllRanges(); setSelection(null) } }
    // Main-chat streaming must not repeatedly scan a selected, unchanged document.
    const observer = new MutationObserver(records => {
      if (captured && (!captured.body.isConnected || captured.sessionId !== currentSessionIdOf(ctx)
        || records.some(record => captured!.view.contains(record.target) || record.target.contains(captured!.view)))) capture()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-textpreview-url', 'data-document-preview', 'data-sidebar-right-session', 'hidden'] })
    document.addEventListener('selectionchange', capture)
    document.addEventListener('mouseup', capture)
    document.addEventListener('keyup', capture)
    document.addEventListener('keydown', escape)
    return () => {
      observer.disconnect()
      document.removeEventListener('selectionchange', capture); document.removeEventListener('mouseup', capture)
      document.removeEventListener('keyup', capture); document.removeEventListener('keydown', escape)
    }
  }, [ctx])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 1600); return () => clearTimeout(timer) }, [notice])
  const available = selection && probeInput(ctx, selection.sessionId).state === 'available'
    && capabilities.capabilities.some(capability => capability.id === 'dock' && capability.state === 'available')
  const add = () => {
    // Re-read after the click: navigation, session changes and PDF rerenders end an old selection.
    const current = captureDocumentSelection(currentSessionIdOf(ctx))
    if (!selection || !current || current.sessionId !== selection.sessionId || current.body !== selection.body
      || current.address !== selection.address || current.text !== selection.text || !available) { setSelection(null); return }
    store.add({ sessionId: current.sessionId, text: current.text, document: current.source })
    window.getSelection()?.removeAllRanges()
    setSelection(null); setNotice(t('documentAdded'))
  }
  return <>{selection && <SelectionToolbarFrame range={selection.range} clip={() => quoteClipOf(selection.body, selection.view)}>
    <button type="button" className={css.toolbarButton} disabled={!available} title={!available ? t('documentWaiting') : undefined}
      onMouseDown={event => event.preventDefault()} onClick={add}>{t('documentAdd')}</button>
    {!available && <span className={css.toolbarStatus} role="status">{t('documentWaiting')}</span>}
  </SelectionToolbarFrame>}{notice && <span className={css.selectionNotice} role="status">{notice}</span>}</>
}

export function registerDocumentQuotes(ctx: Context, store: AnnotationStore): void {
  ctx.effect(() => {
    const host = document.createElement('div')
    host.dataset.sidenoteDocumentUi = ''
    host.dataset.sidenoteNoQuote = ''
    document.body.append(host)
    const root = createRoot(host)
    root.render(<AnnotationBoundary><DocumentSelectionToolbar ctx={ctx} store={store} /></AnnotationBoundary>)
    return () => { setTimeout(() => root.unmount()); host.remove() }
  }, 'dsh-sidenote: document quotes')
}
