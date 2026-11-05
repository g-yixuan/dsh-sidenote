import { useId, useSyncExternalStore } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from './host/contracts.ts'
import { IconListPenOutline16 } from './host/icons.ts'
import { useLocaleTick } from './locale-tick.ts'
import { t } from './locales.ts'
import type { SidenotePreferences } from './preferences.ts'
import css from './settings.module.css'

function SidenoteSettings({ preferences }: { preferences: SidenotePreferences }) {
  useLocaleTick()
  const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot)
  const id = useId()
  return (
    <section className={css.page} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={css.title}>Sidenote</h2>
      <p className={css.description}>{t('settingsDescription')}</p>
      <div className={css.row} role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`}>
        <div className={css.copy}>
          <span id={`${id}-label`} className={css.label}>{t('hideNativeQuote')}</span>
          <p id={`${id}-description`} className={css.hint}>{t('hideNativeQuoteHint')}</p>
        </div>
        <Switch checked={state.hidden} label={t('hideNativeQuote')} title={t('hideNativeQuoteHint')}
          disabled={state.status !== 'ready' || !state.writable || state.saving}
          onChange={hidden => { void preferences.setHidden(hidden) }} />
      </div>
      {state.saving && <p className={css.status} role="status">{t('settingsSaving')}</p>}
      {state.status === 'loading' && <p className={css.status} role="status">{t('settingsLoading')}</p>}
      {state.status === 'unavailable' && <p className={css.error} role="alert">{t('settingsUnavailable')}</p>}
      {state.status === 'ready' && !state.writable && <p className={css.status} role="status">{t('settingsReadOnly')}</p>}
      {state.failed && <p className={css.error} role="alert">{t('settingsSaveFailed')}</p>}
    </section>
  )
}

export function registerSidenoteSettings(ctx: Context, preferences: SidenotePreferences): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-sidenote', label: 'Sidenote', order: 80, registrant: 'dsh-sidenote',
  }, () => <SidenoteSettings preferences={preferences} />))
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', id: 'dsh-sidenote', registrant: 'dsh-sidenote',
  }, ({ size }: { size: number }) => <IconListPenOutline16 size={size} />))
}
