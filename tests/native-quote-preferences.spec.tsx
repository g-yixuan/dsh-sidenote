/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config } from '../src/settings.ts'
import type { Context } from '../src/client/host/contracts.ts'
import { registerNativeQuoteVisibility } from '../src/client/host/selection.tsx'
import { createSidenotePreferences, type SidenoteConfigForm } from '../src/client/preferences.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); document.body.replaceChildren() })

function preferenceFixture(initial?: ReturnType<SidenoteConfigForm['getSnapshot']>) {
  const listeners = new Set<() => void>()
  let state: ReturnType<SidenoteConfigForm['getSnapshot']> = initial ?? { status: 'ready', value: { hideNativeQuote: false }, writable: true }
  const publish = (hidden: boolean): void => {
    state = { ...state, value: { hideNativeQuote: hidden } }
    for (const listener of listeners) listener()
  }
  const form = {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: vi.fn(async (_field: 'hideNativeQuote', hidden: boolean) => { publish(hidden); return true }),
  }
  const preferences = createSidenotePreferences(form)
  cleanup.push(preferences.dispose)
  return { form, preferences, publish }
}

describe('native quotation preferences', () => {
  it('hides native quotes by default while honoring an explicit opt-out', () => {
    expect(Config({}).hideNativeQuote.get()).toBe(true)
    expect(Config({ hideNativeQuote: false }).hideNativeQuote.get()).toBe(false)
    const { preferences, publish } = preferenceFixture({ status: 'loading', value: undefined, writable: false })
    expect(preferences.getSnapshot().hidden).toBe(true)
    publish(false)
    expect(preferences.getSnapshot().hidden).toBe(false)
  })

  it('follows host changes and retains the accepted value after failed writes', async () => {
    const { form, preferences, publish } = preferenceFixture()
    await preferences.setHidden(true)
    expect(preferences.getSnapshot()).toMatchObject({ hidden: true, saving: false, failed: false })
    form.set.mockResolvedValueOnce(false)
    await preferences.setHidden(false)
    expect(preferences.getSnapshot()).toMatchObject({ hidden: true, saving: false, failed: true })
    form.set.mockRejectedValueOnce(new Error('offline'))
    await preferences.setHidden(false)
    expect(preferences.getSnapshot()).toMatchObject({ hidden: true, saving: false, failed: true })
    publish(false)
    expect(preferences.getSnapshot().hidden).toBe(false)
  })

  it('does not admit a second write while the visible switch is saving', async () => {
    const { form, preferences } = preferenceFixture()
    let finish!: (accepted: boolean) => void
    form.set.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const writing = preferences.setHidden(true)
    await preferences.setHidden(false)
    expect(form.set).toHaveBeenCalledTimes(1)
    expect(preferences.getSnapshot().saving).toBe(true)
    finish(false)
    await writing
    expect(preferences.getSnapshot()).toMatchObject({ hidden: false, saving: false, failed: true })
  })

  it('coordinates main and side surfaces, keeps native-only selections and restores the renderer', async () => {
    const { preferences } = preferenceFixture()
    const original = () => <button>Native quote</button>
    const entry = { options: { key: 'quote' }, component: original }
    const disposers: (() => void)[] = []
    const ctx = { slots: {
      inject: (_name: string, callback: () => () => void) => { const dispose = callback(); disposers.push(dispose); return dispose },
      entries: () => [entry],
      subscribe: () => () => {},
    } } as unknown as Context
    const owned = new Set(['main', 'side-a', 'side-b'])
    registerNativeQuoteVisibility(ctx, preferences, sessionId => owned.has(sessionId))
    const wrapped = entry.component
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    cleanup.push(() => { act(() => { root.unmount() }); for (const dispose of disposers) dispose() })
    type Props = { useSession<T>(select: (state: { sessionId: string }) => T): T }
    const render = (sessionId: string): void => {
      const props: Props = { useSession: select => select({ sessionId }) }
      act(() => { root.render(createElement(entry.component as React.ComponentType<Props>, props)) })
    }
    for (const sessionId of owned) { render(sessionId); expect(host.querySelector('button')).toBeNull() }
    owned.clear()
    render('main')
    expect(host.textContent).toBe('Native quote')
    await act(async () => { await preferences.setHidden(true) })
    expect(host.querySelector('button')).toBeNull()
    await act(async () => { await preferences.setHidden(false) })
    expect(host.textContent).toBe('Native quote')
    for (const dispose of disposers.splice(0)) dispose()
    expect(entry.component).toBe(original)
    expect(entry.component).not.toBe(wrapped)
  })
})
