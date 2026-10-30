import { expect, it } from 'vitest'
import { snapshotEntriesOf, snapshotEntriesFromText, serializeSnapshot } from '../src/client/sidechat/snapshot.ts'
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
  const events = [10, 50, 100].map(seq => ({ event: { type: 'session/end-seed', seq, data: { inherited: true } } }))
  expect(savedContextOf([node(20, ' boundary-seq="9"')], events)?.boundarySeq).toBe(9)
  expect(savedContextOf([node(20)], events)?.boundarySeq).toBe(9)
  expect(savedContextOf([node(5)], events)?.boundarySeq).toBe(-1)
  expect(savedContextOf([node(20, ' boundary-seq="25"')], events)).toBeUndefined()
  expect(savedContextOf([node(20), node(60, ' boundary-seq="49"')], events)?.boundarySeq).toBe(49)
})

it('保存副本保留原阅读边界，旧首发快照跳过其前面的恢复标记', () => {
  const node = { kind: 'user', seq: 20, content: [{ type: 'text', text: '<mainline-progress-snapshot><reply>context</reply></mainline-progress-snapshot>question' }] }
  const events = [
    { event: { type: 'session/end-seed', seq: 10, data: { inherited: true } } },
    { event: { type: 'session/end-seed', seq: 15, data: {} } },
    { event: { type: 'session/end-seed', seq: 30, data: { inherited: true } } },
    { event: { type: 'session/end-seed', seq: 40, data: {} } },
  ]
  expect(savedContextOf([node], events)?.boundarySeq).toBe(9)
  expect(savedContextOf([node], events.slice(1), true)).toBeUndefined()
  expect(savedContextOf([node], events, false, 29)).toBeUndefined()
})

it('当前侧聊冻结首条自有快照，不被后续快照或祖先快照覆盖', () => {
  const node = (seq: number, boundary: number, text: string) => ({ kind: 'user', seq, content: [{ type: 'text', text: `<mainline-progress-snapshot boundary-seq="${boundary}"><reply>${text}</reply></mainline-progress-snapshot>question` }] })
  const nodes = [node(20, 9, 'ancestor'), node(60, 49, 'first accepted'), node(70, 49, 'later')]
  expect(savedContextOf(nodes, [], false, 49)?.snapshot).toContain('first accepted')
  expect(savedContextOf(nodes, [])?.snapshot).toContain('later')
  expect(savedContextOf([node(1, -1, 'snapshot only')], [], false, -1)?.boundarySeq).toBe(-1)
})

it('keeps embedded inherited progress when opening another side chat from a saved conversation', () => {
  const nodes = [
    { kind: 'user', seq: 1, content: [{ type: 'text', text: 'obsolete history' }] },
    { kind: 'user', seq: 10, content: [{ type: 'text', text: '<mainline-progress-snapshot taken-at="then"><checkpoint>retained summary</checkpoint><reply>inherited progress</reply></mainline-progress-snapshot>side question' }] },
    { kind: 'assistant', seq: 11, blocks: [{ kind: 'text', text: 'side answer' }] },
  ]
  expect(contextEntriesOf(nodes).map(entry => entry.text)).toEqual(['retained summary', 'inherited progress', 'side question', 'side answer'])
})


it('keeps the real checkpoint ahead of a retained user snapshot from before that compaction', () => {
  const nodes = [
    { kind: 'checkpoint', seq: 100, content: [{ type: 'text', text: 'current summary' }] },
    { kind: 'user', seq: 50, content: [{ type: 'text', text: '<mainline-progress-snapshot><checkpoint>obsolete summary</checkpoint><reply>old progress</reply></mainline-progress-snapshot>retained question' }] },
    { kind: 'assistant', seq: 55, blocks: [{ kind: 'text', text: 'retained answer' }] },
  ]
  expect(contextEntriesOf(nodes).map(entry => entry.text)).toEqual(['current summary', 'retained question', 'retained answer'])
})


it('normalizes the same retained snapshot when compaction happens after opening but before first send', () => {
  const old = serializeSnapshot([{ kind: 'checkpoint', text: 'obsolete summary' }], new Date(), 1)
  const nodes = [
    { kind: 'checkpoint', seq: 100, content: [{ type: 'text', text: 'current summary' }] },
    { kind: 'user', seq: 50, content: [{ type: 'text', text: old + 'retained question' }] },
  ]
  const entries = snapshotEntriesOf(nodes, undefined, 30)
  expect(entries.map(entry => entry.text)).toEqual(['current summary', 'retained question'])
  expect(snapshotEntriesFromText(serializeSnapshot(entries, new Date(), 30)).map(entry => entry.text)).toEqual(['current summary', 'retained question'])
  const legacyWire = serializeSnapshot([{ kind: 'checkpoint', text: 'current summary' }, { kind: 'request', text: old + 'retained question' }], new Date(), 30)
  expect(snapshotEntriesFromText(legacyWire).map(entry => entry.text)).toEqual(['current summary', 'retained question'])
})
