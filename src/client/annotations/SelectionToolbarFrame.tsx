import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { t } from '../locales.ts'
import css from './selection.module.css'

/** Chat and document selections share geometry and appearance, not their actions. */
export function SelectionToolbarFrame({ range, clip, children }: {
  range: Range
  clip(): { left: number; top: number; right: number; bottom: number }
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const toolbar = root.current!
    const place = (): void => {
      if (!range.startContainer.isConnected || range.getClientRects().length === 0) { toolbar.style.visibility = 'hidden'; return }
      const rect = range.getBoundingClientRect(), bounds = clip()
      toolbar.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - 16)}px`
      const { width, height } = toolbar.getBoundingClientRect()
      const left = Math.max(bounds.left + width / 2 + 8, Math.min(bounds.right - width / 2 - 8, rect.left + rect.width / 2))
      const below = rect.top < bounds.top + Math.max(64, height + 10)
      toolbar.style.left = `${left}px`
      toolbar.style.top = `${below ? Math.max(bounds.top + 4, Math.min(bounds.bottom - height - 8, rect.bottom + 10)) : rect.top - 10}px`
      toolbar.classList.toggle(css.toolbarBelow!, below)
      toolbar.style.visibility = rect.bottom > bounds.top && rect.top < bounds.bottom ? 'visible' : 'hidden'
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(toolbar)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  })
  return <div ref={root} className={css.toolbar} role="toolbar" aria-label={t('toolbarAria')}>{children}</div>
}
