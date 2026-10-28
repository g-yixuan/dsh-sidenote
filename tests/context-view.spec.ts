import { expect, it } from 'vitest'
import { contextEntriesOf, contextHistory, savedContextOf } from '../src/client/sidechat/context.ts'

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

it('recovers the original cut after saving and re-forking without hiding side messages', () => {
  const node = (seq: number, attrs = '') => ({ kind: 'user', seq, content: [{ type: 'text', text: `<mainline-progress-snapshot taken-at="now"${attrs}><reply>partial</reply></mainline-progress-snapshot>question` }] })
  const events = [10, 50, 100].map(seq => ({ event: { type: 'session/end-seed', seq } }))
  expect(savedContextOf([node(20, ' boundary-seq="9"')], events)?.boundarySeq).toBe(9)
  expect(savedContextOf([node(20)], events)?.boundarySeq).toBe(9)
  expect(savedContextOf([node(5)], events)?.boundarySeq).toBe(-1)
  expect(savedContextOf([node(20, ' boundary-seq="25"')], events)).toBeUndefined()
  expect(savedContextOf([node(20), node(60, ' boundary-seq="49"')], events)?.boundarySeq).toBe(49)
})

it('keeps embedded inherited progress when opening another side chat from a saved conversation', () => {
  const nodes = [
    { kind: 'user', seq: 1, content: [{ type: 'text', text: 'obsolete history' }] },
    { kind: 'user', seq: 10, content: [{ type: 'text', text: '<mainline-progress-snapshot taken-at="then"><checkpoint>retained summary</checkpoint><reply>inherited progress</reply></mainline-progress-snapshot>side question' }] },
    { kind: 'assistant', seq: 11, blocks: [{ kind: 'text', text: 'side answer' }] },
  ]
  expect(contextEntriesOf(nodes).map(entry => entry.text)).toEqual(['retained summary', 'inherited progress', 'side question', 'side answer'])
})
