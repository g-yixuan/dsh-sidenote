/** @vitest-environment jsdom */
import { act, createElement, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context, SessionListSnapshot } from '../src/client/host/contracts.ts'
import { createSessionVisibility, sessionVisibilityOf, visibleSessionList } from '../src/client/host/sessionVisibility.ts'
import { registerSessionListFilter } from '../src/client/host/sessionList.tsx'
import { clearRootContext } from '../src/client/host/sidebar.ts'
import { openSession } from '../src/client/host/navigation.ts'
import { forkAndRegister, saveSideChatSession } from '../src/client/sidechat/lifecycle.ts'
import { registerSideSessionVisibility } from '../src/client/sidechat/visibility.tsx'
import { dropSideChatMeta, writeSideChatMeta } from '../src/client/sidechat/metaStore.ts'
import { recordClosedSideChat } from '../src/client/sidechat/recentClosed.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
beforeEach(() => { localStorage.clear(); clearRootContext() })
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); clearRootContext() })
const listOf = (...ids: string[]) => ({ ids, byId: Object.fromEntries(ids.map(id => [id, { title: id, blank: false }])), phase: 'ready' as const })

it('hides new rows before the RPC resolves, keeps existing rows live, and reveals unrelated concurrent creations', () => {
  const visibility = createSessionVisibility()
  const before = listOf('parent')
  const finish = visibility.begin(before)
  const during = listOf('parent', 'child', 'other')
  during.byId.parent!.title = 'updated while creating'
  const filtered = visibleSessionList(during, visibility.getSnapshot())
  expect(filtered.ids).toEqual(['parent'])
  expect(filtered.byId.parent!.title).toBe('updated while creating')
  expect(during.ids).toEqual(['parent', 'child', 'other'])
  visibility.hide('child')
  finish(); finish()
  expect(visibleSessionList(during, visibility.getSnapshot()).ids).toEqual(['parent', 'other'])
  expect(visibleSessionList(during, visibility.getSnapshot()).byId.child).toBeUndefined()
})

it('keeps concurrent creation gates independent and releases a failed operation', () => {
  const visibility = createSessionVisibility()
  const first = visibility.begin(listOf('parent'))
  const second = visibility.begin(listOf('parent'))
  first()
  expect(visibleSessionList(listOf('parent', 'formal'), visibility.getSnapshot()).ids).toEqual(['parent'])
  second()
  expect(visibleSessionList(listOf('parent', 'formal'), visibility.getSnapshot()).ids).toEqual(['parent', 'formal'])
})

it('persists more than five children independently of tabs and supports showing them after reload', () => {
  const visibility = createSessionVisibility()
  const children = Array.from({ length: 8 }, (_, index) => `child-${index}`)
  visibility.hide(...children)
  const reloaded = createSessionVisibility()
  const list = listOf('parent', ...children)
  expect(visibleSessionList(list, reloaded.getSnapshot()).ids).toEqual(['parent'])
  reloaded.setShow(true)
  expect(visibleSessionList(list, reloaded.getSnapshot())).toBe(list)
  expect(createSessionVisibility().getSnapshot().show).toBe(true)
  reloaded.setShow(false)
  expect(createSessionVisibility().getSnapshot().hidden.size).toBe(8)
})

it('retains in-memory hiding if storage is unavailable and passes unknown host shapes through', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const visibility = createSessionVisibility()
  visibility.hide('child')
  expect(visibility.getSnapshot().saved).toBe(false)
  expect(visibleSessionList(listOf('parent', 'child'), visibility.getSnapshot()).ids).toEqual(['parent'])
  const unknown = { renamedCatalog: ['child'] }
  expect(visibleSessionList(unknown, visibility.getSnapshot())).toBe(unknown)
})

function mountedWorkspace(children: Record<string, unknown> = { 'sidebar.workspaces.directoryFlow': {} }) {
  const listeners = new Set<() => void>()
  const disposers: Array<() => void> = []
  const callbacks = new Set<() => void>()
  let list: SessionListSnapshot = listOf('parent')
  const useSessions = <T,>(selector: (state: SessionListSnapshot) => T) => useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => selector(list),
  )
  const marker = {}
  const Original = ({ useSessions: readSessions, marker: received }: { useSessions: typeof useSessions; marker: unknown }) => {
    expect(received).toBe(marker)
    const state = readSessions(value => value)
    return <div>{(state.ids as string[]).map(id => <span key={id} data-session-row={id}>{id}</span>)}</div>
  }
  const entry = { component: Original as ComponentType<any>, children }
  const entries = [entry]
  const ctx = {
    get: () => undefined,
    slots: {
      entries: () => entries,
      subscribe: (_key: string, fn: () => void) => { callbacks.add(fn); return () => { callbacks.delete(fn) } },
      inject: (_key: string, callback: () => () => void) => { disposers.push(callback()); return () => {} },
      register: vi.fn(() => () => {}),
    },
    sessions: { list: { getSnapshot: () => list, subscribe: () => () => {} } },
    workspaces: { unarchiveSession: vi.fn() },
  } as unknown as Context
  const visibility = sessionVisibilityOf(ctx)
  registerSessionListFilter(ctx, visibility)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root)
  const render = () => root.render(createElement(entry.component, { useSessions, marker }))
  act(render)
  return {
    ctx, visibility, entry, Original, host, entries,
    render,
    publish(next: SessionListSnapshot) { list = next; for (const fn of [...listeners]) fn() },
    registryChanged() { for (const fn of [...callbacks]) fn() },
    dispose() { for (const off of disposers) off() },
    rows: () => [...host.querySelectorAll('[data-session-row]')].map(node => node.getAttribute('data-session-row')),
  }
}

it('projects a real React workspace while leaving the global catalog untouched, then restores the native entry', () => {
  const env = mountedWorkspace()
  let finish!: () => void
  act(() => { finish = env.visibility.begin(env.ctx.sessions.list.getSnapshot()); env.publish(listOf('parent', 'child')) })
  expect(env.rows()).toEqual(['parent'])
  expect(env.ctx.sessions.list.getSnapshot().byId?.child).toBeDefined()
  act(() => { env.visibility.hide('child'); finish() })
  expect(env.rows()).toEqual(['parent'])
  act(() => env.visibility.setShow(true))
  expect(env.rows()).toEqual(['parent', 'child'])
  act(() => { env.dispose(); env.render() })
  expect(env.entry.component).toBe(env.Original)
  expect(env.rows()).toEqual(['parent', 'child'])
})

it('handles late native entries, ignores unrelated entries, and preserves a subsequent replacement on cleanup', () => {
  const env = mountedWorkspace()
  const unrelated = { component: env.Original, children: {} }
  const late = { component: env.Original, children: { 'sidebar.workspaces.directoryFlow': {} } }
  env.entries.push(unrelated, late)
  env.registryChanged()
  expect(unrelated.component).toBe(env.Original)
  expect(late.component).not.toBe(env.Original)
  const replacement = () => null
  env.entry.component = replacement
  env.dispose()
  expect(env.entry.component).toBe(replacement)
  expect(late.component).toBe(env.Original)
})

for (const fallback of [false, true]) {
  it(`fork lifecycle never renders the early host row (${fallback ? 'busy create fallback' : 'idle fork'})`, async () => {
    const env = mountedWorkspace()
    let resolve!: (id: string) => void
    const request = new Promise<string>(yes => { resolve = yes })
    const binding = { session: { getSnapshot: () => ({ running: fallback, nodes: [] }) } }
    env.ctx.sessions.binding = vi.fn(() => binding) as never
    env.ctx.sessions.fork = fallback
      ? vi.fn(async () => { throw new Error('fork-unavailable: no completed turn') })
      : vi.fn(() => request)
    ;(env.ctx.sessions as unknown as { create: unknown }).create = vi.fn(() => request)
    writeSideChatMeta({ tabId: 'tab', sessionId: 'parent', number: 1, createdAt: 1 })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let creating!: Promise<string>
    await act(async () => { creating = forkAndRegister(env.ctx, 'parent', 'tab'); await Promise.resolve() })
    act(() => env.publish(listOf('parent', 'child')))
    expect(env.rows()).toEqual(['parent'])
    await act(async () => { resolve('child'); await creating })
    expect(env.rows()).toEqual(['parent'])
    expect(env.visibility.getSnapshot().pending).toHaveLength(0)
    env.dispose()
  })
}

it('failed fork releases its gate without hiding another newly created regular session', async () => {
  const env = mountedWorkspace()
  env.ctx.sessions.binding = vi.fn(() => undefined)
  env.ctx.sessions.fork = vi.fn(async () => { throw new Error('offline') })
  await act(async () => { await expect(forkAndRegister(env.ctx, 'parent', 'tab')).rejects.toThrow('offline') })
  act(() => env.publish(listOf('parent', 'formal')))
  expect(env.rows()).toEqual(['parent', 'formal'])
  env.dispose()
})

it('migrates live and closed identities before tab cleanup without depending on the recent menu cap', () => {
  const cleanups: Array<() => void> = []
  const ctx = {
    get: () => undefined, workspaces: {}, slots: { inject() {} },
    effect(fn: () => () => void) { cleanups.push(fn()) },
  } as unknown as Context
  writeSideChatMeta({ tabId: 'tab', sessionId: 'parent', childId: 'live', number: 1, createdAt: 1 })
  recordClosedSideChat('parent', { childId: 'closed', parentSessionId: 'parent', title: 'Side', closedAt: 1 })
  registerSideSessionVisibility(ctx)
  dropSideChatMeta('parent', 'tab')
  for (let index = 0; index < 8; index++) recordClosedSideChat('parent', { childId: `later-${index}`, parentSessionId: 'parent', title: 'Side', closedAt: index + 2 })
  expect(createSessionVisibility().getSnapshot().hidden).toEqual(new Set(['live', 'closed']))
  for (const off of cleanups) off()
})

it('uses the available host navigator and closes the source tab before opening the saved copy', async () => {
  const order: string[] = []
  const workspace = { openSession: vi.fn((id: string) => { order.push(`open:${id}`) }) }
  const ctx = {
    get: (name: string) => name === 'uiWorkspace' ? workspace : name === 'sidebarRight' ? { openTab() {}, close: () => order.push('close') } : undefined,
    sessions: { fork: vi.fn(async () => 'saved'), open: vi.fn() },
  } as unknown as Context
  await saveSideChatSession(ctx, 'child', 'tab', 'parent')
  expect(order).toEqual(['close', 'open:saved'])
  expect(ctx.sessions.fork).toHaveBeenCalledWith({ sessionId: 'child', increaseTitle: true })
  expect(sessionVisibilityOf(ctx).getSnapshot().hidden.has('saved')).toBe(false)
  expect(ctx.sessions.open).not.toHaveBeenCalled()
  const legacy = { get: () => undefined, sessions: { open: vi.fn() } } as unknown as Context
  openSession(legacy, 'parent')
  expect(legacy.sessions.open).toHaveBeenCalledWith('parent')
  expect(() => openSession({ get: () => undefined, sessions: {} } as unknown as Context, 'parent')).toThrow('navigation is unavailable')
})
