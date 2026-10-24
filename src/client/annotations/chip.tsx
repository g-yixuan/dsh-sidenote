/** Shared, compact context dock for both native composers. */
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconListPenOutline16, IconShareOutline16, IconTrashOutline16 } from '../host/icons.ts'
import type { Context, InputZone } from '../host/contracts.ts'
import { resolveInput } from '../host/input.ts'
import { hostDiagnostics } from '../host/probes.ts'
import type { Annotation, AnnotationStore } from './model.ts'
import type { ReflowStore } from '../reflow.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import { AnnotationBoundary } from './boundary.tsx'
import css from './annotations.module.css'

type Kind = 'annotations' | 'reflows'
interface ChipProps { readonly session: InputZone['session']; readonly input: InputZone['input'] }

function AnnotationDetail({ item, store, pending, onEdit }: { item: Annotation; store: AnnotationStore; pending: boolean; onEdit(): void }) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(item.note)
  const cancelled = useRef(false)
  const save = () => { if (!cancelled.current) store.setNote(item.id, note); setEditing(false) }
  return <li className={css.contextItem}>
    <span className={css.contextNumber}>{item.number}.</span>
    <div className={css.contextContent}>
      <div className={css.contextLabel}>{t('selectedText')}</div>
      <div className={css.contextText}>{item.text}</div>
      <div className={css.contextLabel}>{t('userComment')}</div>
      {editing ? <textarea autoFocus rows={3} className={css.contextEditor} aria-label={t('userComment')} value={note} onChange={event => { setNote(event.target.value) }} onBlur={save} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setEditing(false) }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save() }
      }} /> : <div className={css.contextText}>{item.note || <span className={css.contextLabel}>{t('noNote')}</span>}</div>}
    </div>
    <div className={css.contextActions}>
      <button type="button" className={css.contextAction} disabled={pending} aria-label={t(editing ? 'saveNoteAria' : 'editNoteAria')} title={t(editing ? 'saveNoteAria' : 'editNoteAria')} onMouseDown={event => { if (editing) event.preventDefault() }} onClick={() => {
        if (editing) save()
        else { cancelled.current = false; setNote(item.note); setEditing(true); onEdit() }
      }}>{editing ? <IconCheckOutline16 size={16} /> : <IconEditOutline16 size={16} />}</button>
      <button type="button" className={css.contextAction} disabled={pending} aria-label={t('removeAria', { n: item.number })} title={t('removeTitle')} onClick={() => { store.remove(item.id) }}><IconTrashOutline16 size={16} /></button>
    </div>
  </li>
}

function ContextChips({ ctx, store, reflow, sessionId }: { ctx: Context; store: AnnotationStore; reflow: ReflowStore; sessionId: string }) {
  useLocaleTick()
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  useSyncExternalStore(reflow.subscribe, reflow.getSnapshot)
  const diagnostics = hostDiagnostics(ctx)
  const capabilities = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot)
  const [open, setOpen] = useState<{ kind: Kind; pinned: boolean } | null>(null)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined }
  const active = store.listActive(sessionId)
  const reflows = reflow.list(sessionId)
  const submission = store.getSubmission(sessionId)
  const hasItems = open?.kind === 'annotations' ? active.length > 0 : reflows.length > 0
  const shown = open !== null && hasItems
  const label = (kind: Kind) => kind === 'annotations' ? t(active.length === 1 ? 'chipOne' : 'chipMany', { n: active.length }) : t(reflows.length === 1 ? 'reflowChipOne' : 'reflowChipMany', { n: reflows.length })

  useEffect(() => { setOpen(null); return clearTimer }, [sessionId])
  useEffect(() => {
    if (!submission.pending && submission.error === t('inputUnavailable') && resolveInput(ctx, sessionId)) store.setSubmission(sessionId, { pending: false })
  }, [capabilities, sessionId])
  useEffect(() => { if (!hasItems) setOpen(null) }, [hasItems])
  useLayoutEffect(() => {
    if (!shown) return
    const place = () => {
      const rect = root.current!.getBoundingClientRect()
      const width = Math.min(480, rect.width, window.innerWidth - 24)
      setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 8, maxHeight: Math.min(280, window.innerHeight / 3, rect.top - 16) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [shown, open?.kind])
  useLayoutEffect(() => {
    if (shown && open.pinned && root.current?.contains(document.activeElement)) panel.current?.focus()
  }, [shown, open?.kind, open?.pinned])
  useEffect(() => {
    if (!shown) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) { clearTimer(); setOpen(null) } }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); clearTimer(); setOpen(null)
      root.current?.querySelector<HTMLButtonElement>(`[data-context-kind="${open?.kind}"]`)?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [shown, open?.kind])
  const leave = () => {
    clearTimer()
    if (!open?.pinned) timer.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement)) setOpen(null) }, 220)
  }
  const clear = (kind: Kind) => {
    clearTimer()
    if (kind === 'annotations') for (const item of active) store.remove(item.id)
    else reflow.clearSession(sessionId)
    if (open?.kind === kind) setOpen(null)
  }
  const chip = (kind: Kind) => <span className={css.chip} data-open={shown && open.kind === kind || undefined} onPointerEnter={event => {
    if (event.pointerType === 'touch') return
    clearTimer()
    if (!open?.pinned) timer.current = setTimeout(() => { setOpen({ kind, pinned: false }) }, 160)
  }} onPointerLeave={leave}>
    <button type="button" className={css.chipMain} data-context-kind={kind} aria-haspopup="dialog" aria-expanded={shown && open.kind === kind} aria-controls={id} onClick={() => {
      clearTimer(); setOpen(open?.kind === kind && open.pinned ? null : { kind, pinned: true })
    }}>{kind === 'annotations' ? <IconListPenOutline16 size={14} /> : <IconShareOutline16 size={14} />}<span>{label(kind)}</span></button>
    <span className={css.chipDismissShade}><button type="button" className={css.chipDismiss} disabled={submission.pending} aria-label={t(kind === 'annotations' ? 'clearAnnotations' : 'clearReflows')} title={t(kind === 'annotations' ? 'clearAnnotations' : 'clearReflows')} onClick={() => { clear(kind) }}><IconCloseOutline16 size={14} /></button></span>
  </span>
  if (!active.length && !reflows.length && !submission.error) return null
  return <div ref={root} className={css.chipWrap} data-sidenote-context-dock data-sidenote-annotation-ui>
    {active.length > 0 && chip('annotations')}{reflows.length > 0 && chip('reflows')}
    {store.getStorageStatus(sessionId) === 'memory' && <span className={css.storageNotice} role="status">{t('annotationStorageMemory')}</span>}
    {submission.error && <span className={css.storageNotice} role="alert">{submission.error}</span>}
    {shown && createPortal(<div ref={panel} id={id} role="dialog" tabIndex={-1} aria-label={label(open.kind)} className={css.contextPanel} style={position} data-sidenote-context-preview data-sidenote-no-quote onPointerEnter={clearTimer} onPointerLeave={leave}>
      <ul className={css.contextList}>
        {open.kind === 'annotations' ? active.map(item => <AnnotationDetail key={item.id} item={item} store={store} pending={submission.pending} onEdit={() => { setOpen({ kind: 'annotations', pinned: true }) }} />) : reflows.map((item, index) => <li key={item.id} className={css.contextItem}>
          <span className={css.contextNumber}>{index + 1}.</span>
          <div className={css.contextContent}>
            <div className={css.contextSource}>{item.sideTitle}</div>
            {item.question && <><div className={css.contextLabel}>{t('contextrequest')}</div><div className={css.contextText}>{item.question}</div></>}
            <div className={css.contextLabel}>{t('contextreply')}</div><div className={css.contextText}>{item.text}</div>
          </div>
          <div className={css.contextActions}><button type="button" className={css.contextAction} disabled={submission.pending} aria-label={t('reflowRemoveTitle')} title={t('reflowRemoveTitle')} onClick={() => { reflow.remove(item.id) }}><IconTrashOutline16 size={16} /></button></div>
        </li>)}
      </ul>
      <div className={css.contextFooter}><button type="button" className={css.chipClearAll} disabled={submission.pending} onClick={() => { clear(open.kind) }}>{t('clearAll')}</button></div>
    </div>, document.body)}
  </div>
}

export function createContextChips(ctx: Context, store: AnnotationStore, reflow: ReflowStore) {
  return function ContextChipsEntry(props: ChipProps) {
    return <AnnotationBoundary><ContextChips key={props.session.sessionId} ctx={ctx} store={store} reflow={reflow} sessionId={props.session.sessionId} /></AnnotationBoundary>
  }
}
