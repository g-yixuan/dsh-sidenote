import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '../host/contracts.ts'
import { hostDiagnostics, watchHostDiagnostics, type Capability, type DiagnosticReason } from '../host/probes.ts'
import type { CapabilityState } from '../host/input.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import { createDiagnosticMode, type DiagnosticMode } from './mode.ts'
import css from './diagnostics.module.css'

const names = {
  selection: 'diagSelection', dock: 'diagDock', sideOpen: 'diagSideOpen', sideQuote: 'diagSideQuote',
  input: 'diagInput', sideInput: 'diagSideInput', acceptance: 'diagAcceptance', sideAcceptance: 'diagSideAcceptance', chat: 'diagChat', model: 'diagModel',
} as const satisfies Record<Capability['name'], Parameters<typeof t>[0]>
const states = { available: 'diagAvailable', unready: 'diagUnready', unknown: 'diagUnknown', unavailable: 'diagUnavailable' } as const satisfies Record<CapabilityState, Parameters<typeof t>[0]>
const reasons = {
  ready: 'diagReady', waitSession: 'diagWaitSession', waitService: 'diagWaitService', waitInput: 'diagWaitInput',
  unsupported: 'diagUnsupported', readFailed: 'diagReadFailed', waitView: 'diagWaitView', waitDock: 'diagWaitDock',
  waitSide: 'diagWaitSide', unknownAcceptance: 'diagUnknownAcceptance', markersMissing: 'diagMarkersMissing',
} as const satisfies Record<DiagnosticReason, Parameters<typeof t>[0]>

function CompatibilityButton({ ctx }: { ctx: Context }) {
  useLocaleTick()
  const store = hostDiagnostics(ctx)
  const report = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const panelId = useId()
  const close = (): void => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const exportReport = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(store.getSnapshot(), null, 2) + '\n'], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'dsh-sidenote-compatibility.json'; link.click()
    setTimeout(() => { URL.revokeObjectURL(url) }, 0)
  }
  return (
    <div data-sidenote-compatibility>
      <button ref={trigger} type="button" className={css.trigger} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => { store.recheck(); setOpen(!open) }}>
        {t('diagTitle')}
      </button>
      {open && <section ref={panel} id={panelId} tabIndex={-1} className={css.panel} role="dialog" aria-label={t('diagTitle')}>
        <div className={css.header}><strong>{t('diagTitle')}</strong><button type="button" onClick={close} aria-label={t('diagClose')}>×</button></div>
        <p className={css.description}>{t('diagDescription')}</p>
        <p className={css.versions}>sidenote {report.versions.sidenote} · DSH {report.versions.dsh === 'unknown' ? t('diagUnknownVersion') : report.versions.dsh} · BS {report.versions.betterSidebar ?? t('diagNotDetected')}</p>
        <ul className={css.list}>{report.capabilities.map(capability => <li key={capability.id}>
          <div><span>{t(names[capability.name])}</span><strong data-state={capability.state}>{t(states[capability.state])}</strong></div>
          <p>{t(reasons[capability.reason])}</p>
          <details><summary>{t('diagPath')}</summary><code>{capability.path}</code></details>
        </li>)}</ul>
        <div className={css.actions}><button type="button" onClick={store.recheck}>{t('diagRecheck')}</button><button type="button" onClick={exportReport}>{t('diagExport')}</button></div>
      </section>}
    </div>
  )
}

function DiagnosticSettings({ mode }: { mode: DiagnosticMode }) {
  useLocaleTick()
  const { enabled, saved } = useSyncExternalStore(mode.subscribe, mode.getSnapshot)
  const descriptionId = useId()
  return <div className={css.setting}>
    <div>
      <span className={css.settingTitle}>{t('diagMode')}</span>
      <p id={descriptionId} className={css.description}>{t('diagModeDescription')}</p>
      {!saved && <p className={css.description} role="status">{t('diagModeUnsaved')}</p>}
    </div>
    <input type="checkbox" role="switch" aria-label={t('diagMode')} aria-describedby={descriptionId} checked={enabled} onChange={event => { mode.setEnabled(event.currentTarget.checked); event.currentTarget.focus() }} />
  </div>
}

function DiagnosticEntry({ ctx, mode }: { ctx: Context; mode: DiagnosticMode }) {
  const { enabled } = useSyncExternalStore(mode.subscribe, mode.getSnapshot)
  return enabled ? <CompatibilityButton ctx={ctx} /> : null
}

export function registerCompatibilityStatus(ctx: Context): void {
  const mode = createDiagnosticMode()
  // Capability observation also drives input recovery and quote controls.
  // Only diagnostic presentation is opt-in; keep business consumers alive.
  ctx.effect(() => watchHostDiagnostics(ctx), 'dsh-sidenote: host status')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'dsh-sidenote-diagnostics-setting', order: 120, registrant: 'dsh-sidenote',
  }, () => <DiagnosticSettings mode={mode} />))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'dsh-sidenote-compatibility', order: 11, registrant: 'dsh-sidenote',
  }, () => <DiagnosticEntry ctx={ctx} mode={mode} />))
}
