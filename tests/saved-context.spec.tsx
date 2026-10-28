/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SavedConversation } from '../src/client/sidechat/SavedConversation.tsx'
import { contextProjection } from '../src/contextProjection.ts'
import { serializeSnapshot } from '../src/client/sidechat/snapshot.ts'

vi.mock('../src/client/sidechat/InheritedContext.tsx', () => ({ InheritedContext: () => null }))

it('indexes actual markers and preserves their identity across later events and copied logs', () => {
  const content = [{ type: 'text', text: serializeSnapshot([], new Date(), 5) + '\nquestion' }]
  let value = contextProjection.init()
  value = contextProjection.apply(value, { type: 'user/message', seq: 10, data: { content } })
  expect(value).toBe(10)
  for (const type of ['user/message', 'compaction/summary', 'session/end-seed']) {
    value = contextProjection.apply(value, { type, seq: 20, data: { content: [{ type: 'text', text: 'ordinary message' }] } })
    expect(value).toBe(10)
  }
})

it.each([null, undefined, 50])('pages only to a known plugin marker (%s), not every native fork', async marker => {
  let window = { entries: [{ event: { type: 'session/end-seed', seq: 10001, data: {} } }], hasMore: true }
  const loadThrough = vi.fn(async () => { window = { entries: [{ event: { type: 'user/message', seq: 50, data: {} } }, ...window.entries], hasMore: true } })
  const session = { getSnapshot: () => ({ loadingOlder: false }), subscribe: () => () => {}, open: async () => {}, loadThrough,
    eventSource: { getSnapshot: () => window, subscribe: () => () => {} } }
  const state = { legacy: { nodes: [{ kind: 'user', seq: 10000, content: [{ type: 'text', text: 'ordinary message' }] }] } }
  const ctx = { sessions: { binding: () => ({ session }) }, get: () => ({ binding: () => ({ target: () => ({ getSnapshot: () => state, subscribe: () => () => {} }) }) }) }
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => { root.render(createElement(SavedConversation, { ctx, Original: () => createElement('div', null, 'native'), props: { sessionId: 'fork', useProjection: () => marker } } as never)) })
  if (typeof marker === 'number') expect(loadThrough).toHaveBeenCalledExactlyOnceWith(50)
  else expect(loadThrough).not.toHaveBeenCalled()
  expect(host.textContent).toBe('native')
  await act(async () => { root.unmount() })
})
