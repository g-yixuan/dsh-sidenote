import { expect, it, vi } from 'vitest'
import { loadForkBoundary, loadInheritedContext, type ContextEventWindow } from '../src/client/host/chat.ts'
import type { SessionFace } from '../src/client/host/contracts.ts'

function history() {
  let window: ContextEventWindow = { entries: [{ event: { type: 'user/message', seq: 100, data: {} } }], hasMore: true }
  let loadingOlder = false
  const listeners = new Set<() => void>()
  const loadThrough = vi.fn(async (_seq: number) => {})
  const session = {
    open: async () => {}, loadThrough,
    getSnapshot: () => ({ loadingOlder }),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    eventSource: { getSnapshot: () => window },
  } as unknown as SessionFace
  return { session, loadThrough,
    page: (seq: number, seed = false) => { window = { entries: [{ event: { type: seed ? 'session/end-seed' : 'user/message', seq, data: {} } }, ...window.entries], hasMore: seq > 0 } },
    busy: (value: boolean) => { loadingOlder = value; for (const fn of [...listeners]) fn() },
    listeners,
  }
}

it('waits for an ordinary page pull before jumping and checks coverage afterward', async () => {
  const h = history()
  h.busy(true)
  h.loadThrough.mockImplementation(async () => { h.page(10) })
  const pending = loadInheritedContext(h.session, 20)
  await Promise.resolve()
  expect(h.loadThrough).not.toHaveBeenCalled()
  h.page(60); h.busy(false)
  await pending
  expect(h.loadThrough).toHaveBeenCalledExactlyOnceWith(20)
  expect(h.listeners.size).toBe(0)
})

it('rejects a swallowed paging failure rather than accepting an incomplete context', async () => {
  const h = history()
  await expect(loadInheritedContext(h.session, 20)).rejects.toThrow('上下文加载未完成')
})

it('locates the child seed independently of saved metadata without loading ancestor history', async () => {
  const h = history()
  h.loadThrough.mockImplementationOnce(async () => { h.page(80) }).mockImplementationOnce(async () => { h.page(50, true) })
  await expect(loadForkBoundary(h.session)).resolves.toBe(49)
  expect(h.loadThrough.mock.calls).toEqual([[99], [79]])
})
