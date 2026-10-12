import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconCloseOutline16, IconShareOutline16 } from '../host/icons.ts'
import type { InputZone } from '../host/contracts.ts'
import type { ReflowStore } from '../reflow.ts'
import { AnnotationBoundary } from '../annotations/boundary.tsx'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from '../annotations/annotations.module.css'

interface ChipProps { readonly session: InputZone['session']; readonly input: InputZone['input'] }

/** 「侧边回流」chip（dock order 11）：主会话待回流对象的可预览/可移除入口。 */
export function createReflowChip(reflow: ReflowStore) {
  function ReflowChip(props: ChipProps): ReactNode {
    useLocaleTick()
    const sessionId = props.session.sessionId
    useSyncExternalStore(
      useCallback((cb: () => void) => reflow.subscribe(cb), [reflow]),
      () => reflow.getSnapshot(),
    )
    const [expanded, setExpanded] = useState(false)
    const rootRef = useRef<HTMLDivElement | null>(null)

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

    useEffect(() => {
      setExpanded(false)
    }, [sessionId])

    const items = reflow.list(sessionId)
    if (items.length === 0) return null

    return (
      <div ref={rootRef} className={css.chipWrap}>
        <button
          type="button"
          className={css.chip}
          aria-expanded={expanded}
          onClick={() => { setExpanded(open => !open) }}
        >
          <IconShareOutline16 size={12} />
          <span>{t(items.length === 1 ? 'reflowChipOne' : 'reflowChipMany', { n: items.length })}</span>
        </button>
        {expanded && (
          <ul className={css.chipPanel}>
            {items.map(item => (
              <li key={item.id} className={css.chipRow}>
                <span className={css.chipText} title={item.text}>
                  {t('reflowFrom', { title: item.sideTitle })} {item.text.replace(/[*_`#>[\]]/g, '').replace(/\s+/g, ' ')}
                </span>
                <button
                  type="button"
                  className={css.chipRemove}
                  title={t('reflowRemoveTitle')}
                  aria-label={t('reflowRemoveTitle')}
                  onClick={() => { reflow.remove(item.id) }}
                >
                  <IconCloseOutline16 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return function ReflowChipEntry(props: ChipProps): ReactNode {
    return (
      <AnnotationBoundary>
        <ReflowChip {...props} />
      </AnnotationBoundary>
    )
  }
}
