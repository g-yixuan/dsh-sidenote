/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import type { Context, SessionFace } from '../src/client/host/contracts.ts'
import { useComposer } from '../src/client/sidechat/composer.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('re-resolves native input when retain materializes the same child’s Session', () => {
  let retained = false
  const state = { draft: '原生草稿', phase: 'plain' }
  const input = { setDraft() {}, submit() {}, state: { getSnapshot: () => state, subscribe: () => () => {} } }
  const ctx = {
    sessions: { scope: () => retained ? {} : undefined },
    get: (name: string) => name === 'conversation' ? { input: { for: () => input } } : undefined,
  } as unknown as Context
  function View({ session }: { session?: SessionFace }) {
    const composer = useComposer(ctx, session, 'child')
    return <output data-machine={String(composer.machine)}>{composer.draft}</output>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(<View />) })
  expect(host.querySelector('output')?.dataset.machine).toBe('false')
  retained = true
  act(() => { root.render(<View session={{} as SessionFace} />) })
  expect(host.querySelector('output')?.dataset.machine).toBe('true')
  expect(host.textContent).toBe('原生草稿')
  act(() => { root.unmount() }); host.remove()
})
