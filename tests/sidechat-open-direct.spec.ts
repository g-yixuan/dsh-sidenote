// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import { SIDE_TAB_TYPE } from '../src/client/sidechat/model.ts'
import { clearNativeRuntime, registerLiveSideChat } from '../src/client/sidechat/native.ts'
import { createSideChat, openOrFocusSideChat, reopenSideChat, sideChatTargetTitle } from '../src/client/sidechat/open.ts'
import { writeSideChatMeta } from '../src/client/sidechat/metaStore.ts'

const SESSION = 'sess-1'
function fixture() {
  const tabs: { id: string; kind: string; title: string }[] = []
  let active = ''
  const face = {
    tabsIn: () => tabs,
    active: () => tabs.find(tab => tab.id === active),
    openTab: vi.fn(() => { active = `tab-${tabs.length + 1}`; tabs.push({ id: active, kind: SIDE_TAB_TYPE, title: 'Side' }) }),
    focus: vi.fn((id: string) => { active = id }),
    isExpanded: () => true,
  }
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ current: SESSION, byId: {} }) } },
    get: (name: string) => name === 'sidebarRight' ? face : undefined,
  } as unknown as Context
  const add = (id: string, childId?: string) => {
    tabs.push({ id, kind: SIDE_TAB_TYPE, title: id }); active = id
    writeSideChatMeta({ tabId: id, sessionId: SESSION, parentSessionId: SESSION, childId, number: tabs.length, createdAt: 1 })
  }
  return { ctx, face, tabs, add }
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clearNativeRuntime() })

it('explicit creation always opens a new tab, while ordinary opening focuses the selected one', () => {
  const { ctx, face, add } = fixture()
  add('older', 'a'); add('newer', 'b')
  const draftA = vi.fn(), draftB = vi.fn()
  registerLiveSideChat(SESSION, 'older', draftA, () => ({}), () => 'Older')
  registerLiveSideChat(SESSION, 'newer', draftB, () => ({}), () => 'Newer')
  face.focus('older')
  expect(sideChatTargetTitle(ctx, SESSION)).toBe('Older')
  expect(openOrFocusSideChat(ctx, SESSION, 'to A')).toBe(true)
  expect(draftA).toHaveBeenCalledWith('to A')
  expect(draftB).not.toHaveBeenCalled()
  expect(face.openTab).not.toHaveBeenCalled()
  expect(createSideChat(ctx, SESSION, 'new C')).toBe(true)
  expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, { params: { parentSessionId: SESSION, pendingDraft: 'new C' } })
})

it('keeps concurrent opening drafts attached to their actual tabs even when they mount in reverse order', () => {
  const { ctx, face } = fixture()
  createSideChat(ctx, SESSION, 'initial A')
  openOrFocusSideChat(ctx, SESSION, 'later A')
  createSideChat(ctx, SESSION, 'initial B')
  openOrFocusSideChat(ctx, SESSION, 'later B')
  expect(face.openTab).toHaveBeenCalledTimes(2)
  const a = vi.fn(), b = vi.fn()
  registerLiveSideChat(SESSION, 'tab-2', b, () => ({}), () => 'B')
  registerLiveSideChat(SESSION, 'tab-1', a, () => ({}), () => 'A')
  expect(a.mock.calls).toEqual([['later A']])
  expect(b.mock.calls).toEqual([['later B']])
})

it('does not treat stale metadata as an open tab', () => {
  const { ctx, face } = fixture()
  writeSideChatMeta({ tabId: 'ghost', sessionId: SESSION, number: 9, createdAt: 1 })
  expect(openOrFocusSideChat(ctx, SESSION, 'new draft')).toBe(true)
  expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, { params: { parentSessionId: SESSION, pendingDraft: 'new draft' } })
  expect(face.focus).not.toHaveBeenCalledWith('ghost')
})

it('reopens the original child while a sibling exists, then focuses an already open child instead of duplicating it', () => {
  const { ctx, face, add } = fixture()
  add('sibling', 'b')
  expect(reopenSideChat(ctx, SESSION, 'a', { topic: 'Original', savedMeta: { boundarySeq: 7, number: 2 } })).toBe(true)
  expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, { params: { parentSessionId: SESSION, childId: 'a', topic: 'Original', savedMeta: { boundarySeq: 7, number: 2 } } })
  expect(reopenSideChat(ctx, SESSION, 'a')).toBe(true) // still mounting: do not duplicate it
  expect(face.openTab).toHaveBeenCalledTimes(1)
  expect(reopenSideChat(ctx, SESSION, 'b')).toBe(true)
  expect(face.focus).toHaveBeenLastCalledWith('sibling')
  expect(face.openTab).toHaveBeenCalledTimes(1)
})

it('refuses creation outside the on-screen parent and reports a host that did not create a tab', () => {
  const { ctx, face } = fixture()
  expect(createSideChat(ctx, 'other')).toBe(false)
  expect(reopenSideChat(ctx, 'other', 'child')).toBe(false)
  expect(face.openTab).not.toHaveBeenCalled()
  face.openTab.mockImplementation(() => {})
  expect(createSideChat(ctx, SESSION)).toBe(false)
})


it('recognizes an unmounted restored child only when its native address still matches', () => {
  const { ctx, face, tabs } = fixture()
  tabs.push({ id: 'restored', kind: SIDE_TAB_TYPE, title: 'Old' })
  Object.assign(tabs[0]!, { contentId: 'sidebar://side/original' })
  writeSideChatMeta({ tabId: 'restored', sessionId: SESSION, childId: 'original-child', nativeAddress: 'sidebar://side/original', runId: 'previous-page', number: 1, createdAt: 1 })
  expect(reopenSideChat(ctx, SESSION, 'original-child')).toBe(true)
  expect(face.focus).toHaveBeenLastCalledWith('restored')
  expect(face.openTab).not.toHaveBeenCalled()
  Object.assign(tabs[0]!, { contentId: 'sidebar://side/different' })
  expect(reopenSideChat(ctx, SESSION, 'original-child')).toBe(true)
  expect(face.openTab).toHaveBeenCalledTimes(1)
})
