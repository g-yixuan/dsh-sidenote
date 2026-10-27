import { describe, expect, it, vi } from 'vitest'
import { forkAndRegister, retainSession, sessionBusyOf } from '../src/client/sidechat/lifecycle.ts'
import { inheritedBoundarySource, unfinishedCompactionCut } from '../src/client/host/chat.ts'
import { clearForkQueue } from '../src/client/host/submission.ts'
import type { Context, SessionBinding, SessionFace } from '../src/client/host/contracts.ts'

let childSeq = 0
function currentChildId(): string { return `child-${childSeq}` }
function makeEnv(opts: { parentRunning: boolean; endSeq?: number; forkFails?: string; retainRequired?: boolean }) {
  childSeq++
  const child = currentChildId()
  let retained = 0
  let meta: Record<string, unknown> | undefined
  const parent = { session: { getSnapshot: () => ({ running: opts.parentRunning }), subscribe: () => () => {} } }
  const binding = { session: {
    getSnapshot: () => ({ running: false }), cancel: vi.fn(), prompt: vi.fn(), subscribe: () => () => {},
    eventSource: { subscribe: () => () => {}, getSnapshot: () => ({ entries: opts.endSeq === undefined ? [] : [{ event: { type: 'session/end-seed', seq: opts.endSeq + 1 } }] }) },
  } }
  const fork = vi.fn(async () => {
    if (opts.forkFails) throw new Error(opts.forkFails)
    return child
  })
  const create = vi.fn(async () => child)
  const retain = vi.fn(() => { retained++; return { binding, ready: Promise.resolve(binding), release: () => { retained-- } } })
  const target = {
    subscribe: () => () => {},
    getSnapshot: () => ({ legacy: { nodes: [] }, timeline: { turnOrder: [0], turns: new Map([[0, {
      end: opts.endSeq === undefined ? undefined : { seq: opts.endSeq, data: { reason: { kind: 'completed' } } },
    }]]) } }),
  }
  const ctx = {
    get: (key: string) => {
      if (key === 'uiConversation') return { binding: () => ({ target: () => target }) }
      if (key === 'betterSidebar') return { version: '0.18.0', getSnapshot: () => ({}), updateTab: (_id: string, patch: { meta: Record<string, unknown> }) => { meta = patch.meta } }
      return undefined
    },
    sessions: { binding: (id: string) => id === 'parent-1' ? parent : binding, fork, create, ...(opts.retainRequired ? { retain } : {}), list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    workspaces: { unarchiveSession: vi.fn(), archiveSession: vi.fn() },
  } as unknown as Context
  return { ctx, fork, create, retain, retainedCount: () => retained, lastMeta: () => meta, binding }
}

describe('sessionBusyOf（主线忙碌判定）', () => {
  it('running=true → busy；running=false 且无 pending → idle', () => {
    const busy = makeEnv({ parentRunning: true })
    expect(sessionBusyOf(busy.ctx, 'parent-1')).toBe(true)
    const idle = makeEnv({ parentRunning: false })
    expect(sessionBusyOf(idle.ctx, 'parent-1')).toBe(false)
  })

  it('binding 抛错 → fail-open 按空闲（不卡死）', () => {
    const ctx = { sessions: { binding: () => { throw new Error('unknown session') } } } as unknown as Context
    expect(sessionBusyOf(ctx, 'gone')).toBe(false)
  })
})

describe('retainSession（0.1.7 显式 generation 所有权）', () => {
  it('旧宿主无 retain 时保持原 binding 路径', () => {
    const env = makeEnv({ parentRunning: false })
    expect(retainSession(env.ctx, currentChildId())).toBeUndefined()
  })

  it('新宿主按插件来源持有并成对释放', () => {
    const env = makeEnv({ parentRunning: false, retainRequired: true })
    const id = currentChildId()
    const reference = retainSession(env.ctx, id)
    expect(env.retain).toHaveBeenCalledWith(id, { source: 'dsh-sidenote' })
    expect(reference?.binding.session).toBeDefined()
    expect(env.retainedCount()).toBe(1)
    reference?.release()
    expect(env.retainedCount()).toBe(0)
  })
})

describe('fork cut and history ownership', () => {
  it('cuts before an unfinished standalone compression lock, including its failed-close boundary', () => {
    const entries = [{ event: { type: 'command/run', seq: 12, data: { commandId: 'compact-1' } } }, { event: { type: 'compaction/start', seq: 13, data: { turn: null, sourceCommandId: 'compact-1' } } }]
    const session = { eventSource: { getSnapshot: () => ({ entries }) } } as unknown as SessionFace
    expect(unfinishedCompactionCut(session)).toBe(11)
    entries.push({ event: { type: 'compaction/end', seq: 14, data: { turn: null, sourceCommandId: 'compact-1' } } })
    expect(unfinishedCompactionCut(session)).toBeUndefined()
  })
  it('removes only a fresh fork’s pending copies and refuses to proceed on rejection', async () => {
    const updateQueue = vi.fn(async () => ({ ok: true as boolean, error: { message: 'queue rejected' } }))
    const binding = { session: { getSnapshot: () => ({}), updateQueue, projections: { faceOf: () => ({ getSnapshot: () => ({ 'next-turn': [{ id: 'queued' }], 'next-step': [{ id: 'steering' }] }) }) } } } as unknown as SessionBinding
    await clearForkQueue(binding)
    expect(updateQueue.mock.calls).toEqual([['queued', { kind: 'remove' }], ['steering', { kind: 'remove' }]])
    updateQueue.mockResolvedValueOnce({ ok: false, error: { message: 'queue rejected' } })
    await expect(clearForkQueue(binding)).rejects.toThrow('queue rejected')
  })
  it.each([false, true])('reads the actual inherited cut after native fork (busy=%s)', async parentRunning => {
    const env = makeEnv({ parentRunning, endSeq: 12 })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    expect(env.fork).toHaveBeenCalledWith({ sessionId: 'parent-1' })
    expect(env.lastMeta()).toMatchObject({ childId: currentChildId(), boundarySeq: 12 })
    expect(env.lastMeta()?.forkedMidTurn).toBe(parentRunning || undefined)
    expect(env.binding.session.cancel).not.toHaveBeenCalled()
    expect(env.binding.session.prompt).not.toHaveBeenCalled()
  })
  it('uses a snapshot-only child with no inherited rows when no turn has completed', async () => {
    const env = makeEnv({ parentRunning: true, forkFails: 'session/fork-unavailable: no completed turn' })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    expect(env.create).toHaveBeenCalledOnce()
    expect(env.lastMeta()).toMatchObject({ boundarySeq: -1, forkedMidTurn: true, snapshotOnly: true })
  })
  it('does not disguise other fork errors as empty history', async () => {
    const env = makeEnv({ parentRunning: true, forkFails: 'session/not-found' })
    await expect(forkAndRegister(env.ctx, 'parent-1', 'tab1')).rejects.toThrow('not-found')
    expect(env.create).not.toHaveBeenCalled()
  })
  it('recovers the actual child cut from the last seed, not a later user/steering node', () => {
    const subscribe = vi.fn(() => () => {})
    const session = { eventSource: { subscribe, getSnapshot: () => ({ entries: [
      { event: { type: 'session/end-seed', seq: 5 } },
      { event: { type: 'session/end-seed', seq: 13 } },
      { event: { type: 'user/steering', seq: 99 } },
    ] }) } } as unknown as SessionFace
    const source = inheritedBoundarySource(session)!
    expect(source.getSnapshot()).toBe(12)
    source.subscribe(() => {})
    expect(subscribe).toHaveBeenCalledOnce()
    expect(inheritedBoundarySource(undefined)).toBeUndefined()
  })
})
