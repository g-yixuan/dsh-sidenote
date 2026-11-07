import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeFinalReplies, type ReplyDefaultsForm } from '../src/client/host/replyDefaults.ts'

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.restoreAllMocks() })
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

function form<T extends object>(value: T) {
  let snapshot: ReturnType<ReplyDefaultsForm<T>['getSnapshot']> = { status: 'ready', value, writable: true, revision: 0 }
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  const api = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: vi.fn<ReplyDefaultsForm<T>['mutate']>(async (ops, revision) => {
      await Promise.resolve()
      if (snapshot.revision !== revision) return false
      const next = { ...snapshot.value }
      for (const op of ops) Object.assign(next, { [op.path[0]!]: op.value })
      publish({ value: next as T, revision: revision + 1 })
      return true
    }),
  }
  return { api, publish }
}

function fixture() {
  const own = form({ finalRepliesDefaultAttempted: false, hideNativeQuote: true })
  const chat = form<{ foldedReplies: 'all' | 'final'; transcriptView: string }>({ foldedReplies: 'all', transcriptView: 'detailed' })
  const start = () => { disposers.push(initializeFinalReplies(own.api, chat.api)) }
  return { own, chat, start }
}

describe('one-time final replies preference', () => {
  it('claims before overriding an existing all choice, then preserves opt-out after remount', async () => {
    const { own, chat, start } = fixture()
    start()
    await settle()
    expect(own.api.getSnapshot().value).toEqual({ finalRepliesDefaultAttempted: true, hideNativeQuote: true })
    expect(chat.api.getSnapshot().value).toEqual({ foldedReplies: 'final', transcriptView: 'detailed' })
    expect(own.api.mutate.mock.invocationCallOrder[0]).toBeLessThan(chat.api.mutate.mock.invocationCallOrder[0]!)
    chat.publish({ value: { foldedReplies: 'all', transcriptView: 'detailed' }, revision: 2 })
    start()
    await settle()
    expect(chat.api.getSnapshot().value?.foldedReplies).toBe('all')
    expect(chat.api.mutate).toHaveBeenCalledTimes(1)
  })

  it('admits only one concurrent initializer and avoids rewriting an existing final choice', async () => {
    const { own, chat, start } = fixture()
    start(); start()
    await settle()
    expect(chat.api.mutate).toHaveBeenCalledTimes(1)
    own.publish({ value: { finalRepliesDefaultAttempted: false, hideNativeQuote: true }, revision: 2 })
    start()
    await settle()
    expect(own.api.getSnapshot().value?.finalRepliesDefaultAttempted).toBe(true)
    expect(chat.api.mutate).toHaveBeenCalledTimes(1)
  })

  it('waits for writable, loaded configurations and stops after disposal', async () => {
    const { own, chat, start } = fixture()
    own.publish({ status: 'loading', revision: undefined })
    chat.publish({ writable: false })
    start()
    own.publish({ status: 'ready', revision: 0 })
    await settle()
    expect(own.api.mutate).not.toHaveBeenCalled()
    chat.publish({ writable: true })
    disposers.pop()!()
    await settle()
    expect(own.api.getSnapshot().value?.finalRepliesDefaultAttempted).toBe(true)
    expect(chat.api.mutate).not.toHaveBeenCalled()
  })

  it('does not change the preference when the claim fails', async () => {
    const { own, chat, start } = fixture()
    own.api.mutate.mockResolvedValue(false)
    start()
    await settle()
    chat.publish({ revision: 1 })
    await settle()
    expect(own.api.mutate).toHaveBeenCalledTimes(1)
    expect(chat.api.mutate).not.toHaveBeenCalled()
  })

  it('keeps the attempted marker after a failed preference write and does not retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { own, chat, start } = fixture()
    chat.api.mutate.mockRejectedValue(new Error('offline'))
    start()
    await settle()
    start()
    await settle()
    expect(own.api.getSnapshot().value?.finalRepliesDefaultAttempted).toBe(true)
    expect(chat.api.getSnapshot().value?.foldedReplies).toBe('all')
    expect(chat.api.mutate).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a configuration changed while the claim is being persisted', async () => {
    const { own, chat, start } = fixture()
    const claim = own.api.mutate.getMockImplementation()!
    own.api.mutate.mockImplementation(async (...args) => {
      const accepted = await claim(...args)
      chat.publish({ value: { foldedReplies: 'all', transcriptView: 'standard' }, revision: 1 })
      return accepted
    })
    start()
    await settle()
    expect(chat.api.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['foldedReplies'], value: 'final' }], 0)
    expect(chat.api.getSnapshot().value).toEqual({ foldedReplies: 'all', transcriptView: 'standard' })
  })
})
