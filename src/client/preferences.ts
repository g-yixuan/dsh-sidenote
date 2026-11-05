import type { ObservableSnapshot } from './host/contracts.ts'

/** The host ConfigForm subset used by the single Sidenote preference. */
export interface SidenoteConfigForm extends ObservableSnapshot<{
  status: 'loading' | 'ready' | 'unavailable'
  value: { hideNativeQuote: boolean } | undefined
  writable: boolean
}> {
  set(field: 'hideNativeQuote', value: boolean): Promise<boolean>
}

export interface SidenotePreferences extends ObservableSnapshot<{
  hidden: boolean
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  saving: boolean
  failed: boolean
}> {
  setHidden(hidden: boolean): Promise<void>
  dispose(): void
}

/** Share one host-backed value between every main and side conversation. */
export function createSidenotePreferences(form: SidenoteConfigForm): SidenotePreferences {
  const listeners = new Set<() => void>()
  let saving = false
  let failed = false
  const read = () => {
    const state = form.getSnapshot()
    return { hidden: state.value?.hideNativeQuote === true, status: state.status, writable: state.writable, saving, failed }
  }
  let snapshot = read()
  const publish = (): void => {
    snapshot = read()
    for (const listener of listeners) listener()
  }
  const unsubscribe = form.subscribe(publish)
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async setHidden(hidden) {
      if (saving || snapshot.status !== 'ready' || !snapshot.writable) return
      saving = true
      failed = false
      publish()
      try { failed = !await form.set('hideNativeQuote', hidden) }
      catch { failed = true }
      finally { saving = false; publish() }
    },
    dispose() { unsubscribe(); listeners.clear() },
  }
}
