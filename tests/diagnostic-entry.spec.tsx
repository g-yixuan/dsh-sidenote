/** @vitest-environment jsdom */
import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context, KnownSlotKey, SlotRegisterOptions } from '../src/client/host/contracts.ts'
import { registerCompatibilityStatus } from '../src/client/diagnostics/index.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { localStorage.clear(); document.body.replaceChildren() })

it('waits for the settings slot, hides diagnostics by default, and closes with restored focus', () => {
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
  declarations.get('conversation.session.header.utilities')!()
  const Header = components.get('conversation.session.header.utilities')!
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(<Header />) })
  expect(host.querySelector('button')).toBeNull()
  declarations.get('settings.general.item')!()
  const Settings = components.get('settings.general.item')!
  act(() => { root.render(<><Header /><Settings /></>) })
  const toggle = host.querySelector<HTMLInputElement>('[role="switch"]')!
  expect(toggle.checked).toBe(false)
  act(() => { toggle.click() })
  const trigger = host.querySelector('button')!
  act(() => { trigger.click() })
  expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'))
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  act(() => { trigger.click(); toggle.click() })
  expect(host.querySelector('button')).toBeNull()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(toggle)
  // Hiding diagnostics does not stop the business capability observer.
  expect(unwatch).not.toHaveBeenCalled()
  act(() => { root.unmount() })
  for (const off of disposers) off()
  expect(unwatch).toHaveBeenCalledOnce()
})
