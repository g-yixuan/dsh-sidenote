/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { AnnotateOverlay } from '../src/client/annotate/overlay.tsx'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import type { Context } from '../src/client/host/contracts.ts'
import type { SidenotePreferences } from '../src/client/preferences.ts'

vi.mock('../src/client/host/probes.ts', () => {
  const report = { capabilities: [] }
  const diagnostics = { getSnapshot: () => report, subscribe: () => () => {} }
  return { hostDiagnostics: () => diagnostics }
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('owns scroll and mutation observation only while a mounted conversation has geometry to display', () => {
  document.body.innerHTML = '<div data-conversation-session="main"></div><div id="overlay"></div>'
  const store = createAnnotationStore(() => 1, null)
  const list = { byId: {} }
  const ctx = { sessions: { list: { subscribe: () => () => {}, getSnapshot: () => list } } } as unknown as Context
  const state = { selection: null }
  const controller = { getSnapshot: () => state, subscribe: () => () => {}, clear() {}, dispose() {} }
  const preference = { hidden: true, showSideChatNote: true, saving: false, failed: false }
  const preferences = { getSnapshot: () => preference, subscribe: () => () => {} } as unknown as SidenotePreferences
  const added = vi.spyOn(document, 'addEventListener')
  const removed = vi.spyOn(document, 'removeEventListener')
  const observed = vi.spyOn(MutationObserver.prototype, 'observe')
  const root = createRoot(document.getElementById('overlay')!)
  act(() => { root.render(<AnnotateOverlay ctx={ctx} store={store} controller={controller} preferences={preferences} />) })
  expect(added.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(0)
  expect(observed).not.toHaveBeenCalled()
  act(() => { store.add({ sessionId: 'unmounted', anchorKey: undefined, text: 'old reply', anchorText: 'old reply', occurrence: 0, note: '' }) })
  expect(added.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(0)
  let annotation!: ReturnType<typeof store.add>
  act(() => { annotation = store.add({ sessionId: 'main', anchorKey: undefined, text: 'current reply', anchorText: 'current reply', occurrence: 0, note: '' }) })
  expect(added.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(1)
  expect(observed).toHaveBeenCalledTimes(2)
  act(() => { store.remove(annotation.id) })
  expect(removed.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(1)
  act(() => { root.unmount() })
})
