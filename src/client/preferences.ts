import type { ObservableSnapshot } from './host/contracts.ts'

/** The host ConfigForm subset used by Sidenote preferences. */
export interface SidenoteConfigForm extends ObservableSnapshot<{
  status: 'loading' | 'ready' | 'unavailable'
  value: { hideNativeQuote: boolean; showSideChatNote?: boolean } | undefined
  writable: boolean
}> {
  set(field: 'hideNativeQuote' | 'showSideChatNote', value: boolean): Promise<boolean>
}

export interface SidenotePreferences extends ObservableSnapshot<{
  hidden: boolean
  showSideChatNote: boolean
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  saving: boolean
  failed: boolean
}> {
  setHidden(hidden: boolean): Promise<void>
  setShowSideChatNote(show: boolean): Promise<void>
  dispose(): void
}

/** Share host-backed preferences between every main and side conversation. */
export function createSidenotePreferences(form: SidenoteConfigForm): SidenotePreferences {
  const listeners = new Set<() => void>()
  let saving = false
  let failed = false
  const read = () => {
    const state = form.getSnapshot()
    return { hidden: state.value?.hideNativeQuote ?? true, showSideChatNote: state.value?.showSideChatNote ?? true,
      status: state.status, writable: state.writable, saving, failed }
  }
  let snapshot = read()
  const publish = (): void => {
    snapshot = read()
    for (const listener of listeners) listener()
  }
  const unsubscribe = form.subscribe(publish)
  const set = async (field: 'hideNativeQuote' | 'showSideChatNote', value: boolean): Promise<void> => {
    if (saving || snapshot.status !== 'ready' || !snapshot.writable) return
    saving = true
    failed = false
    publish()
    try { failed = !await form.set(field, value) }
    catch { failed = true }
    finally { saving = false; publish() }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setHidden: hidden => set('hideNativeQuote', hidden),
    setShowSideChatNote: show => set('showSideChatNote', show),
    dispose() { unsubscribe(); listeners.clear() },
  }
}
