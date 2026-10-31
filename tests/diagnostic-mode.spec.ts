/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { diagnosticsEnabled } from '../src/client/diagnostics/mode.ts'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear() })

it('requires the developer flag in this tab and ignores the former user preference', () => {
  localStorage.setItem('dsh-sidenote:diagnostics-enabled', 'true')
  localStorage.setItem('dsh-sidenote:developer-diagnostics', 'true')
  expect(diagnosticsEnabled()).toBe(false)
  sessionStorage.setItem('dsh-sidenote:developer-diagnostics', 'true')
  expect(diagnosticsEnabled()).toBe(true)
  sessionStorage.removeItem('dsh-sidenote:developer-diagnostics')
  expect(diagnosticsEnabled()).toBe(false)
})

it('keeps diagnostics off if browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  expect(diagnosticsEnabled()).toBe(false)
})
