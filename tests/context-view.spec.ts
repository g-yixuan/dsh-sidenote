import { expect, it } from 'vitest'
import { contextEntriesOf, contextHistory } from '../src/client/sidechat/context.ts'

it('keeps rich history identities and image-only requests independent of native side rows', () => {
  const image = { id: 'image-1' }
  const history = contextEntriesOf([
    { kind: 'user', seq: 1, content: [{ type: 'image', attachment: image }] },
    { kind: 'assistant', seq: 2, blocks: [{ kind: 'reasoning', text: 'inspect' }, { kind: 'text', text: '**answer**' }] },
    { kind: 'tool-result', seq: 3, call: { name: 'read', argsRaw: '{"path":"a"}' }, content: [{ type: 'text', text: 'result' }] },
  ])
  expect(history).toEqual([
    { key: '1:request', kind: 'request', text: '', images: [image] },
    { key: '2:thinking', kind: 'thinking', text: 'inspect' },
    { key: '2:reply', messageKey: 'a:2', kind: 'reply', text: '**answer**' },
    { key: '3:tool', kind: 'tool', toolName: 'read', text: '调用：{"path":"a"}\nresult' },
  ])
})

it('replaces the inherited prefix only when the progress carries a committed checkpoint', () => {
  const history = contextEntriesOf([{ kind: 'user', seq: 1, content: [{ type: 'text', text: 'old' }] }])
  expect(contextHistory(history, [])).toBe(history)
  expect(contextHistory(history, [{ kind: 'reply', text: 'new' }])).toBe(history)
  expect(contextHistory(history, [{ kind: 'checkpoint', text: 'summary' }, { kind: 'reply', text: 'retained tail' }])).toEqual([])
})
