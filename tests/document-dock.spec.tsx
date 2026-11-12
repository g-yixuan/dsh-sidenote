/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import { createReflowStore } from '../src/client/reflow.ts'
import { createContextChips } from '../src/client/annotations/chip.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('previews and clears document quotes independently from chat annotations, handbacks and other sessions', () => {
  const store = createAnnotationStore(() => 1, null), reflow = createReflowStore(() => 1, null)
  const source = { sessionId: 'main', path: 'docs/notes.md' }
  store.add({ sessionId: 'main', text: '第一段全文', document: source })
  store.add({ sessionId: 'main', text: '第二段全文', document: source })
  store.add({ sessionId: 'child', text: '另一个对话', document: source })
  const chat = store.add({ sessionId: 'main', text: '聊天原文', note: '修改意见', anchorKey: 'a', anchorText: '聊天原文', occurrence: 0 })
  reflow.add('main', 'Side', '回流结论')
  const ctx = { get: () => undefined, sessions: { list: { getSnapshot: () => ({ current: 'main' }) }, binding: () => undefined } } as unknown as Context
  const Dock = createContextChips(ctx, store, reflow)
  const host = document.createElement('div'), root = createRoot(host)
  document.body.append(host)
  try {
    act(() => root.render(<Dock session={{ sessionId: 'main', running: false }} input={{} as never} />))
    const documents = host.querySelector<HTMLButtonElement>('[data-context-kind="documents"]')!
    expect(documents.textContent).toContain('×2')
    act(() => documents.click())
    const panel = document.querySelector('[data-sidenote-context-preview]')!
    expect(panel.textContent).toContain('第一段全文')
    expect(panel.textContent).toContain('docs/notes.md')
    expect(panel.textContent).not.toContain('另一个对话')
    expect(panel.querySelector('textarea')).toBeNull()
    expect(panel.querySelectorAll('button')).toHaveLength(3)
    act(() => panel.querySelector<HTMLButtonElement>('button')!.click())
    expect(documents.textContent).toContain('×1')
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Clear document quotes"]')!.click())
    expect(host.querySelector('[data-context-kind="documents"]')).toBeNull()
    expect(store.get(chat.id)?.number).toBe(1)
    expect(store.listActive('main')).toHaveLength(1)
    expect(store.listActive('child')).toHaveLength(1)
    expect(reflow.list('main')).toHaveLength(1)
  } finally { act(() => root.unmount()); host.remove() }
})
