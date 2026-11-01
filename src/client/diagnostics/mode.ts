/** Developer-only opt-in for this tab; reload to apply and close the tab to reset. */
const KEY = 'dsh-sidenote:developer-diagnostics'

export function diagnosticsEnabled(): boolean {
  try { return window.sessionStorage.getItem(KEY) === 'true' } catch { return false }
}
