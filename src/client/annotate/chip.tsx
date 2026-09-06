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
import { IconCloseOutline16, IconListPenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputZone } from '../../context-types.ts'
import type { AnnotationStore } from './model.ts'
import { t, useLocaleTick } from '../locales.ts'
import { AnnotateErrorBoundary } from './overlay.tsx'
import css from './annotate.module.css'

/** Props the dock skeleton hands us: the InputZone owner share (point-in-time). */
interface ChipProps {
  readonly session: InputZone['session']
  readonly input: InputZone['input']
}

/** Create the slot component bound to one store instance. */
export function createAnnotationChip(store: AnnotationStore) {
  function AnnotationChip(props: ChipProps): ReactNode {
    useLocaleTick()
    const sessionId = props.session.sessionId
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
    if (active.length === 0) return null

    return (
      <div ref={rootRef} className={css.chipWrap}>
        <button
          type="button"
          className={css.chip}
          aria-expanded={expanded}
          onClick={() => { setExpanded(open => !open) }}
        >
          <IconListPenOutline16 size={12} />
          <span>{t(active.length === 1 ? 'chipOne' : 'chipMany', { n: active.length })}</span>
        </button>
        {expanded && (
          <ul className={css.chipPanel}>
            {active.map(annotation => (
              <li key={annotation.id} className={css.chipRow}>
                <span className={css.chipNumber}>{annotation.number}</span>
                <span className={css.chipText} title={annotation.text}>
                  {annotation.text}
                  {annotation.note !== '' && <span className={css.chipNote}>{t('chipNote', { note: annotation.note })}</span>}
                </span>
                <button
                  type="button"
                  className={css.chipRemove}
                  title={t('removeTitle')}
                  aria-label={t('removeAria', { n: annotation.number })}
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

  return function AnnotationChipEntry(props: ChipProps): ReactNode {
    return (
      <AnnotateErrorBoundary>
        <AnnotationChip {...props} />
      </AnnotateErrorBoundary>
    )
  }
}
