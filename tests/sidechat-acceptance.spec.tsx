/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context, SessionFace } from '../src/client/host/contracts.ts'
import { SideChatPanel } from '../src/client/sidechat/SideChatPanel.tsx'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import { submissionExtrasOf } from '../src/client/annotations/submissionExtras.ts'
import { createReflowStore } from '../src/client/reflow.ts'
import { dropSideChatMeta, readSideChatMeta, writeSideChatMeta } from '../src/client/sidechat/metaStore.ts'

const { accept } = vi.hoisted(() => ({ accept: vi.fn() }))
vi.mock('../src/client/sidechat/useMainContext.ts', () => ({ useMainContext: () => ({
  boundarySeq: 0, messages: [], history: [], contextPending: true, accept,
}) }))
vi.mock('../src/client/sidechat/composer.ts', () => ({ useComposer: () => ({ machine: true, pending: false, hasDraft: false }) }))

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it.each([false, true])('keeps delayed acceptance attached to its native tab lifetime (closed=%s)', async closed => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const snapshot = { running: false, nodes: [] }
  const session = { getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as SessionFace
  const binding = { session }
  const list = { phase: 'ready', byId: { old: {} } }
  const ctx = { get: () => undefined,
    sessions: { binding: () => binding, retain: () => ({ binding, ready: Promise.resolve(binding), release() {} }), list: { getSnapshot: () => list, subscribe: () => () => {} } },
    workspaces: { unarchiveSession: async () => {} },
  } as unknown as Context
  const original = { sessionId: 'parent', parentSessionId: 'parent', tabId: 'tab', nativeAddress: 'old-address', childId: 'old', boundarySeq: 0, forkedMidTurn: true as const, number: 1, createdAt: 1 }
  writeSideChatMeta(original)
  const controller = new AbortController()
  const root = createRoot(document.createElement('div'))
  await act(async () => { root.render(createElement(SideChatPanel, {
    ctx, scope: { sessionId: 'parent' }, tab: { id: 'tab', type: 'side', title: 'Side', meta: original }, visible: true,
    signal: controller.signal, closeSource: () => {}, annotations: createAnnotationStore(Date.now, null), reflow: createReflowStore(), renderConversation: () => null,
  } as never)) })
  const callbacks = submissionExtrasOf('old')!
  if (closed) {
    controller.abort()
    await act(async () => { root.unmount() })
    dropSideChatMeta('parent', 'tab')
    writeSideChatMeta({ ...original, childId: 'replacement', nativeAddress: 'new-address', createdAt: 2 })
  }
  try {
    await act(async () => { callbacks.onSubmitText('old question'); callbacks.onAccepted() })
    const current = readSideChatMeta('parent', 'tab')!
    expect(current.childId).toBe(closed ? 'replacement' : 'old')
    expect(current.forkedMidTurn).toBe(closed ? true : undefined)
    expect(current.topic).toBe(closed ? undefined : 'old question')
    expect(accept).toHaveBeenCalledTimes(closed ? 0 : 1)
  } finally { if (!closed) await act(async () => { root.unmount() }) }
})
