import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { conversationViewOf, focusSideComposer } from '../host/dom.ts'
import { IconTrashOutline16 } from '../host/icons.ts'
import { MenuSurface } from '../host/menuSurface.ts'
import { useLocaleTick } from '../locale-tick.ts'
import { t } from '../locales.ts'
import css from './side-menu.module.css'

export type SideMenuItem = {
  kind: 'new' | 'focus' | 'reopen'
  id: string
  label: string
  detail?: string
  title?: string
}

const keyOf = (item: SideMenuItem) => `${item.kind}:${item.id}`

export function SideChatMenu({ readItems, onSelect, onRemove, onClose }: {
  readItems(): SideMenuItem[]
  onSelect(item: SideMenuItem): boolean
  onRemove(item: SideMenuItem): boolean
  onClose(): void
}) {
  useLocaleTick()
  const [items, setItems] = useState(readItems)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState('new:new')
  const [confirming, setConfirming] = useState<string>()
  const [error, setError] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const selectedRow = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const needle = query.trim().toLowerCase()
  const matches = (item: SideMenuItem): boolean => `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(needle)
  const shown = items.filter(matches)
  const active = shown.find(item => keyOf(item) === highlight) ?? shown[0]
  const activeKey = active && keyOf(active)
  const close = (restoreFocus: boolean): void => {
    if (restoreFocus && root.current) focusSideComposer(conversationViewOf(root.current))
    onClose()
  }

  useLayoutEffect(() => {
    const card = root.current
    if (!card) return
    const resize = (): void => { card.style.maxHeight = `${Math.max(0, Math.min(320, card.getBoundingClientRect().bottom - 8))}px` }
    resize()
    search.current?.focus({ preventScroll: true })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [onClose])
  useEffect(() => {
    const card = root.current
    return () => { queueMicrotask(() => { if (!card?.isConnected) onClose() }) }
  }, [onClose])
  useLayoutEffect(() => {
    if (confirming) {
      cancelButton.current?.focus({ preventScroll: true })
      cancelButton.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [confirming])
  useLayoutEffect(() => { if (!confirming) selectedRow.current?.scrollIntoView({ block: 'nearest' }) }, [activeKey, query, confirming])

  function select(item: SideMenuItem): void {
    if (onSelect(item)) close(true)
    else { setItems(readItems()); setError(true) }
  }
  function remove(item: SideMenuItem): void {
    const success = onRemove(item)
    const next = readItems()
    const remaining = next.filter(matches)
    const nearby = remaining[Math.min(shown.indexOf(item), remaining.length - 1)]
    setItems(next)
    setConfirming(undefined)
    setHighlight(nearby ? keyOf(nearby) : '')
    setError(!success)
    search.current?.focus({ preventScroll: true })
  }
  function handleKey(event: KeyboardEvent): void {
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (confirming) { setConfirming(undefined); search.current?.focus({ preventScroll: true }) }
      else close(true)
      return
    }
    if (event.target !== search.current || !active || confirming) return
    if (event.key === 'Enter') { event.preventDefault(); select(active); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const index = (shown.indexOf(active) + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
      setHighlight(keyOf(shown[index]!))
    }
  }

  function renderRow(item: SideMenuItem) {
    const key = keyOf(item)
    const selected = active && keyOf(active) === key
    return <div key={key} className={css.row} data-sidenote-side-menu-row="" data-active={selected || undefined} onMouseEnter={() => setHighlight(key)}>
      {confirming === key ? <div className={css.confirmation}>
        <div className={css.confirmTitle}>{t('cmdRemoveConfirm', { title: item.title ?? item.label })}</div>
        <div className={css.confirmHint}>{t('cmdRemoveHint')}</div>
        <div className={css.confirmActions}>
          <button type="button" ref={cancelButton} onClick={() => { setConfirming(undefined); search.current?.focus({ preventScroll: true }) }}>{t('cmdRemoveCancel')}</button>
          <button type="button" className={css.danger} onClick={() => remove(item)}>{t('cmdRemove')}</button>
        </div>
      </div> : <>
        <button type="button" ref={selected ? selectedRow : undefined} className={css.choice} onFocus={() => setHighlight(key)} onClick={() => select(item)}>
          <span className={css.label}>{item.label}</span>{item.detail && <span className={css.detail}>{item.detail}</span>}
        </button>
        {item.kind === 'reopen' && <Tooltip label={t('cmdRemove')} side="top"><button type="button" className={css.remove}
          aria-label={t('cmdRemoveNamed', { title: item.title ?? item.label })} onFocus={() => setHighlight(key)} onClick={() => { setHighlight(key); setConfirming(key); setError(false) }}>
          <IconTrashOutline16 size={15} />
        </button></Tooltip>}
      </>}
    </div>
  }

  return <MenuSurface ref={root} className={css.card} role="dialog" aria-label={t('cmdMenuTitle')} data-sidenote-side-menu=""
    onKeyDown={handleKey} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onClose() }}
    onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div className={css.search}>
      <input ref={search} aria-label={t('cmdSearch')} placeholder={t('cmdSearchPlaceholder')} value={query}
        onChange={event => { setQuery(event.target.value); setHighlight(''); setConfirming(undefined); setError(false) }} />
    </div>
    {error && <div className={css.error} role="alert">{t('cmdMenuFailed')}</div>}
    <div className={css.viewport}>
      {shown.filter(item => item.kind === 'new').map(renderRow)}
      {(['focus', 'reopen'] as const).map(kind => {
        const group = shown.filter(item => item.kind === kind)
        return group.length > 0 && <div key={kind} className={css.group} role="group" aria-label={t(kind === 'focus' ? 'cmdOpenGroup' : 'cmdClosedGroup')}>
          <div className={css.heading}>{t(kind === 'focus' ? 'cmdOpenGroup' : 'cmdClosedGroup')}</div>
          {group.map(renderRow)}
        </div>
      })}
      {shown.length === 0 && <div className={css.empty}>{t('cmdNoMatches')}</div>}
    </div>
  </MenuSurface>
}
