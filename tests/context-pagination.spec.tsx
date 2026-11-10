/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InheritedContext, type InheritedContextData } from '../src/client/sidechat/InheritedContext.tsx'
import type { ContextEntry } from '../src/client/sidechat/context.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

function reader(context: InheritedContextData) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = async (value = context) => act(async () => { root.render(createElement(InheritedContext, { context: value })) })
  const click = async (button: HTMLButtonElement) => act(async () => { button.click() })
  const earlier = () => [...host.querySelectorAll('button')].find(button => /Load earlier|Loading context/.test(button.textContent ?? ''))!
  return { host, render, click, earlier, unmount: async () => act(async () => { root.unmount() }) }
}
function history(count: number): ContextEntry[] {
  return Array.from({ length: count }, (_, seq) => ({ key: `${seq}:reply`, kind: 'reply', text: `context-${seq}` }))
}

it('defers 5,000 inherited rows while folded and mounts only the latest page on expansion', async () => {
  const rows = history(5_000)
  const readContext = vi.fn(() => ({ history: rows }))
  const loadContext = vi.fn(async () => {})
  const v = reader({ sessionId: 'large', readContext, loadContext })
  try {
    await v.render()
    expect(readContext).not.toHaveBeenCalled()
    await v.click(v.host.querySelector('button')!)
    expect(readContext).toHaveBeenCalledOnce()
    expect(loadContext).toHaveBeenCalledOnce()
    expect(v.host.querySelectorAll('[data-context-key]')).toHaveLength(80)
    expect(v.host.querySelector('[data-context-key]')?.getAttribute('data-context-key')).toBe('4920:reply')
    await v.click(v.earlier())
    expect(v.host.querySelectorAll('[data-context-key]')).toHaveLength(160)
    expect(rows).toHaveLength(5_000)
  } finally { await v.unmount() }
})

it('uses already loaded rows before requesting one earlier native page and preserves reading position', async () => {
  const loadEarlier = vi.fn(async () => {})
  const v = reader({ sessionId: 'paging', history: history(160), hasMoreContext: true, loadEarlier })
  try {
    await v.render(); await v.click(v.host.querySelector('button')!)
    const scroll = v.host.querySelector<HTMLElement>('[data-sidenote-context-progress]')!
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => v.host.querySelectorAll('[data-context-key]').length * 10 })
    scroll.scrollTop = 300
    await v.click(v.earlier())
    expect(loadEarlier).not.toHaveBeenCalled()
    expect(scroll.scrollTop).toBe(1100)
    await v.click(v.earlier())
    expect(loadEarlier).toHaveBeenCalledOnce()
  } finally { await v.unmount() }
})

it('does not apply a late page failure to a replacement side chat', async () => {
  let reject!: (reason: Error) => void
  const loadEarlier = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
  const v = reader({ sessionId: 'old', history: [], hasMoreContext: true, loadEarlier })
  try {
    await v.render(); await v.click(v.host.querySelector('button')!)
    await v.click(v.earlier())
    expect(loadEarlier).toHaveBeenCalledOnce()
    await v.render({ sessionId: 'new', history: history(1) })
    await act(async () => { reject(new Error('old page failed')) })
    expect(v.host.textContent).not.toContain('old page failed')
  } finally { await v.unmount() }
})
