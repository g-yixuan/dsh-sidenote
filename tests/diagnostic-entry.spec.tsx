/** @vitest-environment jsdom */
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context, KnownSlotKey, SlotRegisterOptions } from '../src/client/host/contracts.ts'
import { registerCompatibilityStatus } from '../src/client/diagnostics/index.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { localStorage.clear(); sessionStorage.clear(); document.body.replaceChildren() })

it.each([false, true])('registers diagnostics only with the developer flag (%s), without a settings row', enabled => {
  localStorage.setItem('dsh-sidenote:diagnostics-enabled', 'true')
  if (enabled) sessionStorage.setItem('dsh-sidenote:developer-diagnostics', 'true')
  const declarations = new Map<KnownSlotKey, () => unknown>()
  const components = new Map<KnownSlotKey, ComponentType>()
  const disposers: (() => void)[] = []
  const unwatch = vi.fn()
  const ctx = {
    sessions: { list: { getSnapshot: () => ({}), subscribe: () => unwatch } },
    get: () => undefined, inject() {},
    effect(fn: () => unknown) { const off = fn(); if (typeof off === 'function') disposers.push(off as () => void) },
    slots: {
      inject(key: KnownSlotKey, callback: () => unknown) { declarations.set(key, callback) },
      register(options: SlotRegisterOptions, component: ComponentType) { components.set(options.name, component); return () => components.delete(options.name) },
    },
  } as unknown as Context
  registerCompatibilityStatus(ctx)
  expect(declarations.has('settings.general.item')).toBe(false)
  expect(declarations.has('conversation.session.header.utilities')).toBe(enabled)
  if (enabled) {
    declarations.get('conversation.session.header.utilities')!()
    const Header = components.get('conversation.session.header.utilities')!
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    act(() => { root.render(<Header />) })
    const trigger = host.querySelector('button')!
    act(() => { trigger.click() })
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'))
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    act(() => { root.unmount() })
  }
  // Diagnostic presentation never controls the business capability observer.
  expect(unwatch).not.toHaveBeenCalled()
  for (const off of disposers) off()
  expect(unwatch).toHaveBeenCalledOnce()
})
