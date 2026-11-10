import { afterEach, expect, it, vi } from 'vitest'
import { SIDE_TAB_TYPE } from '../src/client/sidechat/model.ts'
import type { Context } from '../src/client/host/contracts.ts'
import { captureSideChatTarget, ensureSideChatTarget } from '../src/client/sidechat/target.ts'
import { clearNativeRuntime, liveSideChat, liveSideChatsOf, notifyLiveSideChats, registerLiveSideChat } from '../src/client/sidechat/native.ts'

afterEach(() => { clearNativeRuntime(); vi.useRealTimers() })
const ctx = {
  sessions: { list: { getSnapshot: () => ({ current: 'parent' }) } },
  get: (name: string) => name === 'sidebarRight' ? { openTab() {}, focus() {}, isExpanded: () => true, tabsIn: (id: string) => liveSideChatsOf(id).map(panel => ({ id: panel.tabId, kind: SIDE_TAB_TYPE, title: panel.readTitle() })), active: () => undefined } : undefined,
} as unknown as Context

it('waits for the originally selected panel even if a newer ready panel appears', async () => {
  let status: { phase: string; childId?: string } = { phase: 'forking' }
  registerLiveSideChat('parent', 'chosen', () => {}, () => ({}), () => 'Chosen', () => status)
  const target = ensureSideChatTarget(ctx, 'parent', new AbortController().signal)
  registerLiveSideChat('parent', 'newer', () => {}, () => ({}), () => 'Newer', () => ({ phase: 'chat', childId: 'wrong-child' }))
  status = { phase: 'chat', childId: 'chosen-child' }; notifyLiveSideChats()
  expect(await target).toMatchObject({ childId: 'chosen-child', title: 'Chosen' })
})

it('reports target closure instead of silently choosing another panel', async () => {
  const close = registerLiveSideChat('parent', 'chosen', () => {}, () => ({}), () => 'Chosen', () => ({ phase: 'forking' }))
  const target = ensureSideChatTarget(ctx, 'parent', new AbortController().signal)
  const rejection = expect(target).rejects.toThrow('已关闭')
  registerLiveSideChat('parent', 'newer', () => {}, () => ({}), () => 'Newer', () => ({ phase: 'chat', childId: 'wrong-child' }))
  close(); await rejection
})

it('Escape cancellation terminates the wait before a later fork completes', async () => {
  registerLiveSideChat('parent', 'chosen', () => {}, () => ({}), () => 'Chosen', () => ({ phase: 'forking' }))
  const abort = new AbortController()
  const target = ensureSideChatTarget(ctx, 'parent', abort.signal)
  const rejection = expect(target).rejects.toThrow('取消')
  abort.abort(); await rejection
})

it('keeps waiting for a slow native fork until it is ready or explicitly cancelled', async () => {
  vi.useFakeTimers()
  let status: { phase: string; childId?: string } = { phase: 'forking' }
  registerLiveSideChat('parent', 'slow', () => {}, () => ({}), () => 'Slow', () => status)
  let settled = false
  const target = ensureSideChatTarget(ctx, 'parent', new AbortController().signal)
  void target.then(() => { settled = true }, () => { settled = true })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(settled).toBe(false)
  status = { phase: 'chat', childId: 'slow-child' }; notifyLiveSideChats()
  expect(await target).toMatchObject({ childId: 'slow-child' })
})

it('identical native tab ids remain isolated by parent session', async () => {
  registerLiveSideChat('parent', 'tab2', () => {}, () => ({}), () => 'Correct', () => ({ phase: 'chat', childId: 'correct' }))
  registerLiveSideChat('other', 'tab2', () => {}, () => ({}), () => 'Other', () => ({ phase: 'chat', childId: 'other' }))
  expect(liveSideChat('tab2')).toBeUndefined()
  expect(liveSideChat('tab2', 'parent')?.sessionId).toBe('parent')
  const target = await ensureSideChatTarget(ctx, 'parent', new AbortController().signal)
  expect(target.childId).toBe('correct')
  expect(target.isOpen()).toBe(true)
})

it('closing a target during note editing does not redirect the saved quote to a newer tab', async () => {
  const close = registerLiveSideChat('parent', 'chosen', () => {}, () => ({}), () => 'Chosen', () => ({ phase: 'chat', childId: 'chosen-child' }))
  const captured = captureSideChatTarget(ctx, 'parent')
  close()
  registerLiveSideChat('parent', 'newer', () => {}, () => ({}), () => 'Newer', () => ({ phase: 'chat', childId: 'wrong-child' }))
  await expect(captured.resolve(new AbortController().signal)).rejects.toThrow('已关闭')
})


it('captures the selected older tab instead of the most recently created one', async () => {
  registerLiveSideChat('parent', 'A', () => {}, () => ({}), () => 'A', () => ({ phase: 'chat', childId: 'child-A' }))
  registerLiveSideChat('parent', 'B', () => {}, () => ({}), () => 'B', () => ({ phase: 'chat', childId: 'child-B' }))
  let active = 'A'
  const facade = ctx.get('sidebarRight') as object
  const selected = { ...ctx, get: (name: string) => name === 'sidebarRight' ? { ...facade, active: () => ({ id: active, kind: SIDE_TAB_TYPE }) } : undefined } as Context
  const captured = captureSideChatTarget(selected, 'parent')
  active = 'B'
  const target = await captured.resolve(new AbortController().signal)
  expect(target.childId).toBe('child-A')
})
