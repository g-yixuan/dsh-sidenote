/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import { probeInput } from '../src/client/host/input.ts'
import { hostDiagnostics } from '../src/client/host/probes.ts'

afterEach(() => { document.body.replaceChildren() })

function fixture() {
  const state = { draft: '', phase: 'plain' }
  const input = { setDraft() {}, submit() {}, state: { getSnapshot: () => state, subscribe: () => () => {} } }
  let conversation: unknown
  const services = new Map<string, unknown>()
  const session = { getSnapshot: () => ({ sessionId: 'private-session', nodes: [], running: false }), subscribe: () => () => {} }
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ current: 'private-session' }) }, binding: () => ({ session }), scope: () => ({}) },
    connection: { api: { sessions: {} } },
    get: (key: string) => key === 'conversation' ? conversation : services.get(key),
  } as unknown as Context
  return { ctx, input, supply: (value: unknown) => { conversation = value }, supplyService: (key: string, value: unknown) => { services.set(key, value) } }
}

it('absence is waiting, a supplied incompatible facade is unavailable, and readiness can recover', () => {
  const f = fixture()
  expect(probeInput(f.ctx, 'private-session').state).toBe('unready')
  f.supply({ input: { for: () => ({ ...f.input, submit: undefined }) } })
  expect(probeInput(f.ctx, 'private-session')).toMatchObject({ state: 'unavailable', reason: 'unsupported' })
  f.supply({ input: { for: () => f.input } })
  expect(probeInput(f.ctx, 'private-session')).toMatchObject({ state: 'available', input: f.input })
  f.supply({ input: { for() { throw new Error('secret token private path') } } })
  expect(probeInput(f.ctx, 'private-session')).toMatchObject({ state: 'unknown', reason: 'readFailed' })
})

it('distinguishes absent sidebar/model services from supplied incompatible methods', () => {
  const f = fixture(), diagnostics = hostDiagnostics(f.ctx)
  const stateOf = (id: string) => diagnostics.getSnapshot().capabilities.find(cap => cap.id === id)?.state
  expect(stateOf('sideOpen')).toBe('unready'); expect(stateOf('model')).toBe('unready')
  f.supplyService('sidebarRight', {})
  f.supplyService('remote.session', {})
  diagnostics.recheck()
  expect(stateOf('sideOpen')).toBe('unavailable'); expect(stateOf('model')).toBe('unavailable')
  f.supplyService('sidebarRight', { openTab() {} })
  f.supplyService('remote.session', { selectModel() {}, modelCatalog() {} })
  diagnostics.recheck()
  expect(stateOf('sideOpen')).toBe('available'); expect(stateOf('model')).toBe('available')
})

it('diagnostics use the actual input resolver, update after readiness, and export no private data', () => {
  const f = fixture()
  const diagnostics = hostDiagnostics(f.ctx)
  expect(diagnostics.getSnapshot().capabilities.find(cap => cap.id === 'input')?.state).toBe('unready')
  f.supply({ input: { for: () => f.input } })
  diagnostics.recheck()
  expect(diagnostics.getSnapshot().capabilities.find(cap => cap.id === 'input')?.state).toBe('available')
  // A method/reader alone cannot claim a message was accepted.
  expect(diagnostics.getSnapshot().capabilities.find(cap => cap.id === 'acceptance')?.state).toBe('unknown')
  const json = JSON.stringify(diagnostics.getSnapshot())
  expect(json).not.toMatch(/private-session|token|secret|\/Users\/|draft|sessionId/)
  expect(diagnostics.getSnapshot().versions.dsh).toBe('unknown')
})
