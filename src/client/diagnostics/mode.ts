/** Browser-local opt-in shared by the settings row and diagnostic entry. */
const KEY = 'dsh-sidenote:diagnostics-enabled'

export function createDiagnosticMode() {
  let enabled = false
  let saved = true
  try { enabled = window.localStorage.getItem(KEY) === 'true' } catch { saved = false }
  let snapshot = { enabled, saved }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    setEnabled(value: boolean): void {
      let saved = true
      try { window.localStorage.setItem(KEY, String(value)) } catch { saved = false }
      snapshot = { enabled: value, saved }
      for (const fn of [...listeners]) fn()
    },
  }
}

export type DiagnosticMode = ReturnType<typeof createDiagnosticMode>
