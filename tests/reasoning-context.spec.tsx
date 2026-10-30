/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ContextProgress } from '../src/client/sidechat/ContextProgress.tsx'
import { reasoningDisplayText } from '../src/client/host/reasoning.ts'
import { serializeSnapshot } from '../src/client/sidechat/snapshot.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('hides streamed signature metadata in both context preview and body, preserving durable input', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div'), root = createRoot(host)
  const raw = '<signature>private-metadata</signature>\n\nVisible reasoning'
  const entry = Object.freeze({ kind: 'thinking' as const, text: raw, unfinished: true })
  const saved = serializeSnapshot([entry], new Date(0))
  const render = async (text: string) => act(async () => { root.render(createElement(ContextProgress, {
    id: 'context', history: [], entries: [{ ...entry, text }], live: true, loading: false, onRetry() {},
  })) })
  try {
    for (const text of ['<', '<sign', '<signature>private-metadata', '<signature>private-metadata</signature>\n']) {
      await render(text)
      expect(host.querySelector('[data-context-kind="thinking"]')).toBeNull()
      expect(host.textContent).not.toContain('private-metadata')
    }
    await render(raw)
    const row = host.querySelector('details')!
    expect(row.querySelector('summary')?.textContent).toContain('Visible reasoning')
    expect(row.lastElementChild?.textContent).toBe('Visible reasoning')
    expect(row.textContent).not.toContain('private-metadata')
    expect(entry.text).toBe(raw)
    expect(serializeSnapshot([entry], new Date(0))).toBe(saved)
    expect(saved).toContain('private-metadata')
  } finally {
    await act(async () => { root.unmount() })
    vi.unstubAllGlobals()
  }
})

it.each(['', '普通思考', '\n  original  \n', '<note>keep</note>', 'Discuss <signature>literally</signature>'])('keeps ordinary reasoning unchanged: %s', text => {
  expect(reasoningDisplayText(text)).toBe(text)
})

it('strips only the leading complete signature and blank line separators', () => {
  expect(reasoningDisplayText('<signature>metadata</signature>\r\n\r\n  indented')).toBe('  indented')
  expect(reasoningDisplayText('<signature>metadata</signature>\rbody')).toBe('\rbody')
})
