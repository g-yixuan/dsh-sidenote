/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { createDiagnosticMode } from '../src/client/diagnostics/mode.ts'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

it('starts disabled and remembers only an explicit local choice across remounts', () => {
  const mode = createDiagnosticMode()
  expect(mode.getSnapshot().enabled).toBe(false)
  mode.setEnabled(true)
  expect(createDiagnosticMode().getSnapshot()).toEqual({ enabled: true, saved: true })
  mode.setEnabled(false)
  expect(createDiagnosticMode().getSnapshot().enabled).toBe(false)
})

it('keeps a refused storage choice usable for this page while a fresh mount stays disabled', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  const mode = createDiagnosticMode()
  expect(mode.getSnapshot().enabled).toBe(false)
  const listener = vi.fn(), off = mode.subscribe(listener)
  mode.setEnabled(true)
  expect(mode.getSnapshot()).toEqual({ enabled: true, saved: false })
  expect(listener).toHaveBeenCalledOnce()
  expect(createDiagnosticMode().getSnapshot().enabled).toBe(false)
  off()
  mode.setEnabled(false)
  expect(listener).toHaveBeenCalledOnce()
})
