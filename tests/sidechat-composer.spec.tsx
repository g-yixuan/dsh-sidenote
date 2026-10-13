/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Context, SessionFace } from '../src/client/host/contracts.ts'
import { useComposer } from '../src/client/sidechat/composer.ts'
import { hostDiagnostics } from '../src/client/host/probes.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('re-resolves native input when retain materializes the same child’s Session', () => {
  let retained = false
  const state = { draft: '原生草稿', phase: 'plain' }
  const input = { setDraft() {}, submit() {}, state: { getSnapshot: () => state, subscribe: () => () => {} } }
  const ctx = {
    sessions: { scope: () => retained ? {} : undefined },
    get: (name: string) => name === 'conversation' ? { input: { for: () => input } } : undefined,
  } as unknown as Context
  function View({ session }: { session?: SessionFace }) {
    const composer = useComposer(ctx, session, 'child')
    return <output data-machine={String(composer.machine)}>{composer.draft}</output>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(<View />) })
  expect(host.querySelector('output')?.dataset.machine).toBe('false')
  retained = true
  act(() => { root.render(<View session={{} as SessionFace} />) })
  expect(host.querySelector('output')?.dataset.machine).toBe('true')
  expect(host.textContent).toBe('原生草稿')
  act(() => { root.unmount() }); host.remove()
})

it('retains a local body while input is absent and moves it into an empty native draft after readiness', () => {
  let available = false
  let state = { draft: '', phase: 'plain' }
  const listeners = new Set<() => void>()
  const input = {
    setDraft(text: string) { state = { ...state, draft: text }; for (const listener of listeners) listener() }, submit() {},
    state: { getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } } },
  }
  const session = {} as SessionFace
  const ctx = {
    sessions: { scope: () => ({}), list: { getSnapshot: () => ({ current: 'parent' }) }, binding: () => undefined },
    get: (name: string) => name === 'conversation' && available ? { input: { for: () => input } } : undefined,
    connection: { api: { sessions: {} } },
  } as unknown as Context
  function View() {
    const composer = useComposer(ctx, session, 'child')
    return <><button onClick={() => { composer.setDraft('local body to retain') }}>Type local</button><output data-machine={String(composer.machine)}>{composer.draft}</output></>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(<View />) })
  act(() => { host.querySelector('button')!.click() })
  expect(host.querySelector('output')?.textContent).toBe('local body to retain')
  available = true
  act(() => { hostDiagnostics(ctx).recheck() })
  expect(host.querySelector('output')?.dataset.machine).toBe('true')
  expect(host.querySelector('output')?.textContent).toBe('local body to retain')
  expect(state.draft).toBe('local body to retain')
  act(() => { root.unmount() }); host.remove()
})

it('rechecks the live input when a service changes before React observes its diagnostics', () => {
  const submit = vi.fn()
  const state = { draft: 'body kept at the service boundary', phase: 'plain' }
  const input = { setDraft() {}, submit, state: { getSnapshot: () => state, subscribe: () => () => {} } }
  let current: unknown = input
  const ctx = {
    sessions: { scope: () => ({}), list: { getSnapshot: () => ({ current: 'parent' }) }, binding: () => undefined },
    get: (name: string) => name === 'conversation' ? { input: { for: () => current } } : undefined,
    connection: { api: { sessions: {} } },
  } as unknown as Context
  const session = {} as SessionFace
  function View() {
    const composer = useComposer(ctx, session, 'child')
    return <><button onClick={() => { composer.submit() }}>Send</button><output>{composer.draft}</output><p role="alert">{composer.sendError}</p></>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(<View />) })
  current = { ...input, submit: undefined }
  act(() => { host.querySelector('button')!.click() })
  expect(submit).not.toHaveBeenCalled()
  expect(host.querySelector('output')?.textContent).toBe(state.draft)
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Cannot send right now|暂时无法发送/)
  current = input
  act(() => { host.querySelector('button')!.click() })
  expect(submit).toHaveBeenCalledOnce()
  act(() => { root.unmount() }); host.remove()
})
