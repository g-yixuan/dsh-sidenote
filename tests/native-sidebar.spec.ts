/**
 * native.ts + the model-sync helpers in lifecycle.ts: the better-sidebar 0.19
 * bridge. Pure logic only — no DOM, no host.
 */
import { describe, expect, it, vi } from 'vitest'
import { lastLiveSideChat, liveSideChat, nativeSidebarHost, nativeTabShell, registerLiveSideChat, rootContext, setRootContext } from '../src/client/sidechat/native.ts'
import { projectedModelSelection, remoteSessionFace } from '../src/client/sidechat/lifecycle.ts'
import type { Context } from '../src/client/host/contracts.ts'

function ctxWithVersion(version: string): Context {
  return { betterSidebar: { version } } as unknown as Context
}

describe('nativeSidebarHost', () => {
  it('>= 0.19 is native; older/unparsable keeps legacy behaviour', () => {
    expect(nativeSidebarHost(ctxWithVersion('0.19.0'))).toBe(true)
    expect(nativeSidebarHost(ctxWithVersion('0.20.1'))).toBe(true)
    expect(nativeSidebarHost(ctxWithVersion('1.0.0'))).toBe(true)
    expect(nativeSidebarHost(ctxWithVersion('0.18.9'))).toBe(false)
    expect(nativeSidebarHost(ctxWithVersion('nope'))).toBe(false)
    expect(nativeSidebarHost({} as Context)).toBe(false)
  })
})

describe('rootContext', () => {
  it('falls back until setRootContext, then prefers the root', () => {
    const fallback = { tag: 'slot' } as unknown as Context
    const root = { tag: 'root' } as unknown as Context
    setRootContext(root)
    expect(rootContext(fallback)).toBe(root)
  })
})

describe('live side-chat registry', () => {
  it('registers, reads back meta, finds the last panel of a session, disposes', () => {
    const meta = { childId: 'child-1' }
    const dispose = registerLiveSideChat('sess-1', 'tab-1', () => {}, () => meta)
    expect(liveSideChat('tab-1')).toMatchObject({ tabId: 'tab-1', sessionId: 'sess-1' })
    expect(nativeTabShell('tab-1', 'sidechat')).toMatchObject({ id: 'tab-1', type: 'sidechat', meta })
    expect(lastLiveSideChat('sess-1')?.tabId).toBe('tab-1')
    dispose()
    expect(liveSideChat('tab-1')).toBeUndefined()
    expect(nativeTabShell('tab-1', 'sidechat')).toBeUndefined()
  })
})

describe('projectedModelSelection / remoteSessionFace', () => {
  const selection = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }

  it('reads the modelSelection projection snapshot', () => {
    const ctx = {
      sessions: {
        binding: () => ({
          session: { projections: { faceOf: (name: string) => name === 'modelSelection' ? { getSnapshot: () => ({ next: selection }) } : undefined } },
        }),
      },
    } as unknown as Context
    expect(projectedModelSelection(ctx, 'sess-1')).toEqual(selection)
  })

  it('returns undefined when the projection is absent or throws', () => {
    expect(projectedModelSelection({ sessions: { binding: () => undefined } } as unknown as Context, 'sess-1')).toBeUndefined()
    const throwing = { sessions: { binding: () => { throw new Error('no face') } } } as unknown as Context
    expect(projectedModelSelection(throwing, 'sess-1')).toBeUndefined()
  })

  it('probes ctx.remote.session first and ctx.get("remote.session") second', () => {
    const face = { selectModel: vi.fn() }
    expect(remoteSessionFace({ remote: { session: face } } as unknown as Context)).toBe(face)
    const viaGet = { get: (name: string) => name === 'remote.session' ? face : undefined } as unknown as Context
    expect(remoteSessionFace(viaGet)).toBe(face)
    expect(remoteSessionFace({ get: () => undefined } as unknown as Context)).toBeUndefined()
  })
})
