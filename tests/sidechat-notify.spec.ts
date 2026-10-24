// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('../src/client/sidechat/toast.tsx', () => ({ showToast }))
import { registerCompletionNotify } from '../src/client/sidechat/notify.ts'
import { dropSideChatMeta, sideChatMetasAll, writeSideChatMeta } from '../src/client/sidechat/metaStore.ts'
import type { Context } from '../src/client/host/contracts.ts'

beforeEach(() => { showToast.mockClear(); for (const m of sideChatMetasAll()) dropSideChatMeta(m.sessionId, m.tabId); vi.useFakeTimers(); vi.setSystemTime(1000) })
afterEach(() => { vi.useRealTimers() })
function watch() {
  let running = true, seq = 10, reason = 'completed'
  const sessionListeners = new Set<() => void>(), chatListeners = new Set<() => void>()
  const session = { getSnapshot: () => ({ running }), subscribe(fn: () => void) { sessionListeners.add(fn); return () => { sessionListeners.delete(fn) } } }
  const target = { getSnapshot: () => ({ legacy: { nodes: [] }, timeline: { turnOrder: [1], turns: new Map([[1, { end: { seq, data: { reason: { kind: reason } } } }]]) } }), subscribe(fn: () => void) { chatListeners.add(fn); return () => { chatListeners.delete(fn) } } }
  let dispose: (() => void) | undefined
  writeSideChatMeta({ sessionId: 'parent', tabId: 'tab', childId: 'child', number: 1, createdAt: 1 })
  const ctx = { effect(fn: () => () => void) { dispose = fn() }, get: (name: string) => name === 'uiConversation' ? { binding: () => ({ target: () => target }) } : undefined, sessions: { binding: () => ({ session }) } } as unknown as Context
  registerCompletionNotify(ctx)
  vi.setSystemTime(3000)
  return {
    idle() { running = false; for (const fn of sessionListeners) fn() },
    end(kind: string) { reason = kind; seq++; for (const fn of chatListeners) fn() },
    listenerCount: () => sessionListeners.size + chatListeners.size,
    dispose: () => dispose?.(),
  }
}
describe('completion notifications', () => {
  it('does not equate an idle transition with a successful reply', () => {
    const host = watch(); host.idle(); expect(showToast).not.toHaveBeenCalled(); host.end('completed'); expect(showToast).toHaveBeenCalledTimes(1); host.dispose()
  })
  it.each(['cancelled', 'interrupted', 'error', 'max-tokens'])('does not announce %s as completed', kind => {
    const host = watch(); host.idle(); host.end(kind); expect(showToast).not.toHaveBeenCalled(); host.dispose()
  })
  it('looks up the current title and disposes both subscriptions when closed', () => {
    const host = watch(); writeSideChatMeta({ sessionId: 'parent', tabId: 'tab', childId: 'child', number: 1, topic: 'updated topic', createdAt: 1 }); host.idle(); host.end('completed')
    expect(showToast.mock.calls[0]![0]).toContain('updated topic')
    dropSideChatMeta('parent', 'tab'); expect(host.listenerCount()).toBe(0); host.dispose()
  })
  it('does not replay historical completion or suppress a genuinely fast new reply', () => {
    const host = watch()
    expect(showToast).not.toHaveBeenCalled()
    vi.setSystemTime(1100)
    host.idle(); host.end('completed')
    expect(showToast).toHaveBeenCalledTimes(1)
    host.dispose()
  })
})
