/**
 * The 「N 条注释」 composer chip (Delivery_02 重构): a `conversation.input.dock`
 * list entry (the official composer-attachment seat; todo dock lives at order
 * 0, the queue strip at 20 — we sit between at 10). The chip counts the
 * session's ACTIVE annotations and expands inline to preview/remove each one.
 *
 * 架构分工：chip 只呈现与增删注释对象；发送携带由 send.ts 拦截器负责
 * （协议块在提交瞬间拼入，草稿不再被污染），sent 迁移也由拦截器显式触发
 * ——chip 不再监听草稿发送沿。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { IconCloseOutline16, IconListPenOutline16 } from '../host/icons.ts'
import type { InputZone } from '../host/contracts.ts'
import type { AnnotationStore } from './model.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import { AnnotationBoundary } from './boundary.tsx'
import css from './annotations.module.css'

/** Props the dock skeleton hands us: the InputZone owner share (point-in-time). */
interface ChipProps {
  readonly session: InputZone['session']
  readonly input: InputZone['input']
}

function AnnotationChipInner(props: { store: AnnotationStore; targetSessionId: string; side?: boolean }): ReactNode {
  useLocaleTick()
  const { store, targetSessionId: sessionId } = props
  useSyncExternalStore(
    useCallback((cb: () => void) => store.subscribe(cb), [store]),
    () => store.getSnapshot(),
  )
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 展开态的关闭路径：Esc / 点击面板外部（与浮层编辑器同款心智）。
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setExpanded(false)
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root === null || !(event.target instanceof Node)) return
      if (!root.contains(event.target)) setExpanded(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [expanded])

  // 会话切换时收起展开态（slot 组件实例不随会话切换重建）。
  useEffect(() => {
    setExpanded(false)
  }, [sessionId])

  const active = store.listActive(sessionId)
  const submission = store.getSubmission(sessionId)
  if (active.length === 0 && submission.error === undefined) return null

  return (
    <div ref={rootRef} className={[css.chipWrap, props.side ? css.side : ''].join(' ')} data-sidenote-annotation-ui="">
      {store.getStorageStatus(sessionId) === 'memory' && <span className={css.storageNotice} role="status">{t('annotationStorageMemory')}</span>}
      {submission.error !== undefined && <span className={css.storageNotice} role="alert">{submission.error}</span>}
      {active.length > 0 && <button
        type="button"
        className={css.chip}
        aria-expanded={expanded}
        onClick={() => { setExpanded(open => !open) }}
      >
        <IconListPenOutline16 size={12} />
        <span>{t(active.length === 1 ? 'chipOne' : 'chipMany', { n: active.length })}</span>
      </button>}
      {expanded && active.length > 0 && (
        <ul className={css.chipPanel}>
          {active.map(annotation => (
            <li key={annotation.id} className={css.chipRow}>
              <span className={css.chipNumber}>{annotation.number}</span>
              <span className={css.chipText} title={annotation.note === '' ? annotation.text : annotation.text + '\n' + t('chipNote', { note: annotation.note })}>
                {annotation.text}
                {annotation.note !== '' && <span className={css.chipNote}>{t('chipNote', { note: annotation.note })}</span>}
              </span>
              <button
                type="button"
                className={css.chipRemove}
                title={t('removeTitle')}
                aria-label={t('removeAria', { n: annotation.number })}
                disabled={submission.pending}
                onClick={() => { store.remove(annotation.id) }}
              >
                <IconCloseOutline16 size={12} />
              </button>
            </li>
          ))}
          <li className={css.chipRow}>
            <button
              type="button"
              className={css.chipClearAll}
              disabled={submission.pending}
              onClick={() => { for (const a of active) store.remove(a.id) }}
            >
              {t('clearAll')}
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

export function AnnotationChip(props: { store: AnnotationStore; targetSessionId: string; side?: boolean }): ReactNode {
  return <AnnotationBoundary><AnnotationChipInner {...props} /></AnnotationBoundary>
}

/** Main dock adapter; side composers render the same AnnotationChip directly. */
export function createAnnotationChip(store: AnnotationStore) {
  return function AnnotationChipEntry(props: ChipProps): ReactNode {
    return <AnnotationChip store={store} targetSessionId={props.session.sessionId} />
  }
}
