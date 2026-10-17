import { useId, useSyncExternalStore } from 'react'
import type { Context } from '../host/contracts.ts'
import { registerSessionListFilter } from '../host/sessionList.tsx'
import { sessionVisibilityOf, type SessionVisibility } from '../host/sessionVisibility.ts'
import { sideChatMetasAll } from './metaStore.ts'
import { allClosedSideChats } from './recentClosed.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

function VisibilitySetting({ visibility }: { visibility: SessionVisibility }) {
  useLocaleTick()
  const { show, saved } = useSyncExternalStore(visibility.subscribe, visibility.getSnapshot)
  const description = useId()
  return <div className={css.visibilitySetting}>
    <div><strong>{t('showSideSessions')}</strong><p id={description}>{t('showSideSessionsDescription')}</p>
      {!saved && <p role="status">{t('sideSessionsUnsaved')}</p>}
    </div>
    <input type="checkbox" role="switch" aria-label={t('showSideSessions')} aria-describedby={description} checked={show} onChange={event => visibility.setShow(event.currentTarget.checked)} />
  </div>
}

/** Run before orphan-meta cleanup so previous live/closed children can migrate. */
export function registerSideSessionVisibility(ctx: Context): void {
  const visibility = sessionVisibilityOf(ctx)
  const ids = [...sideChatMetasAll(), ...allClosedSideChats()].flatMap(record => record.childId ? [record.childId] : [])
  visibility.hide(...ids)
  ctx.effect(() => visibility.watch(), 'dsh-sidenote: side session visibility')
  registerSessionListFilter(ctx, visibility)
  // Historical hosts keep archive-based hiding and their existing /side recovery.
  if (typeof ctx.workspaces.unarchiveSession !== 'function') return
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'dsh-sidenote-side-sessions-setting', order: 119, registrant: 'dsh-sidenote',
  }, () => <VisibilitySetting visibility={visibility} />))
}
