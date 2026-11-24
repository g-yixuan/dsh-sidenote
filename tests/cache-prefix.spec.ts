import { describe, expect, it, vi } from 'vitest'
import type { Context, SessionFace, SessionInput } from '../src/client/host/contracts.ts'
import { chatSourceOf } from '../src/client/host/chat.ts'
import { canTransferDraft } from '../src/client/host/input.ts'
import { canRefreshContext, prepareCachedContext } from '../src/client/sidechat/cache.ts'

const event = (seq: number, type: string, data = {}) => ({ event: { seq, type, data } })
function session(entries: ReturnType<typeof event>[], extra = {}) {
  return { getSnapshot: () => ({ running: false, nodes: [] }), eventSource: { getSnapshot: () => ({ entries }), subscribe: () => () => {} }, ...extra } as unknown as SessionFace
}

describe('cache-preserving first send', () => {
  it.each(['user/message', 'command/run', 'agent/inbox/spliced', 'turn/start'])('does not replace child-owned %s', type => {
    expect(canRefreshContext(session([event(5, 'session/end-seed'), event(6, type)]), 4)).toBe(false)
  })
  it('allows model selection but requires the complete child tail', () => {
    expect(canRefreshContext(session([event(5, 'session/end-seed'), event(6, 'model/selection')]), 4)).toBe(true)
    const partial = session([], { eventSource: { getSnapshot: () => ({ hasMore: true, entries: [event(9, 'model/selection')] }) } })
    expect(canRefreshContext(partial, 4)).toBe(false)
  })
  it.each([
    { attachmentIds: ['image'] }, { occurrences: [{ source: 'file' }] }, { phase: 'submitting' },
  ])('keeps nontransferable drafts on their original input: %j', state => {
    const input = { state: { getSnapshot: () => ({ phase: 'plain', ...state }) } } as unknown as SessionInput
    expect(canTransferDraft(input)).toBe(false)
  })
  it('preserves native quote nodes even without reference occurrences', () => {
    const input = { state: { getSnapshot: () => ({ phase: 'plain' }) }, draftSnapshot: { quotes: [{}] } } as unknown as SessionInput
    expect(canTransferDraft(input)).toBe(false)
  })
  it('uses one exact native fork cut and freezes the uncommitted tail before fork resolves', async () => {
    const entries = [event(0, 'turn/start'), event(1, 'user/message'), event(2, 'assistant/message'), event(2.5, 'assistant/stream')]
    let partial = 'unfinished at click'
    const parent = session(entries, { getSnapshot: () => ({ running: true, nodes: [], partial }) })
    const child = session([event(0, 'session/end-seed'), event(1, 'model/selection')], {
      projections: { faceOf: () => ({ getSnapshot: () => ({ next: { provider: 'test', model: 'flash', reasoningEffort: 'low' } }) }) },
    })
    const target = session([event(3, 'session/end-seed', { inherited: true })])
    const input = { state: { getSnapshot: () => ({ draft: '', phase: 'plain' }), subscribe: () => () => {} }, setDraft: vi.fn(), submit: vi.fn() } as unknown as SessionInput
    const fork = vi.fn(async () => { partial = 'later output'; entries.push(event(3, 'assistant/message')); return 'new-child' })
    const selectModel = vi.fn(async () => ({ ok: true }))
    const releases: string[] = []
    const bindings = { parent: { session: parent }, child: { session: child }, 'new-child': { session: target } }
    const ctx = {
      sessions: {
        binding: (id: keyof typeof bindings) => bindings[id], fork, scope: () => ({}),
        retain: (id: keyof typeof bindings) => ({ ready: Promise.resolve(bindings[id]), release: () => releases.push(id) }),
        list: { getSnapshot: () => ({ byId: {} }) },
      },
      get: (name: string) => name === 'remote.session' ? { selectModel } : name === 'conversation' ? { input: { for: () => input } } : undefined,
    } as unknown as Context
    const prepared = await prepareCachedContext(ctx, 'parent', 'child', -1)
    expect(fork).toHaveBeenCalledWith({ sessionId: 'parent', atSeq: 2 })
    expect(prepared?.text).toContain('unfinished at click')
    expect(prepared?.text).not.toContain('later output')
    expect(selectModel).toHaveBeenCalledWith({ sessionId: 'new-child', provider: 'test', model: 'flash', reasoningEffort: 'low' })
    expect(releases).toEqual(['parent'])
    prepared!.dispose()
    expect(releases).toEqual(['parent', 'new-child'])
  })
})

it('waits for a newly retained chat projection before reading its completed turns', () => {
  const ctx = { get: () => ({ binding: () => ({ target: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }) }) } as unknown as Context
  const source = chatSourceOf(ctx, { session: session([]) })!
  expect(source.getLegacy()).toBeNull()
  expect(source.getCompletedReplySeqs!()).toEqual([])
  expect(source.getLastTurnEnd!()).toBeUndefined()
})
