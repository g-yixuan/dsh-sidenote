import { expect, it } from 'vitest'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import { buildProtocolBlock, splitProtocolPrefix } from '../src/client/annotations/format.ts'

const source = { sessionId: 'source-workspace', path: 'docs/论文 & "设计".pdf', pageStart: 2, pageEnd: 3 }

it('keeps excerpt snapshots isolated and persistent, with numbering independent from chat badges', () => {
  const data = new Map<string, string>()
  const storage = { get length() { return data.size }, key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  const store = createAnnotationStore(() => 1, storage)
  const first = store.add({ sessionId: 'main', text: '第一段', document: source })
  const chat = store.add({ sessionId: 'main', text: '聊天原文', note: '意见', anchorKey: 'a:1', anchorText: '聊天原文', occurrence: 0 })
  const second = store.add({ sessionId: 'main', text: '第二段', document: source })
  expect([first.number, chat.number, second.number]).toEqual([1, 1, 2])
  expect(first).not.toHaveProperty('anchorKey')
  store.setNote(first.id, '不应变成批注')
  expect(store.get(first.id)?.note).toBe('')
  store.remove(first.id)
  expect(store.get(second.id)?.number).toBe(1)
  expect(store.get(chat.id)?.number).toBe(1)
  expect(createAnnotationStore(() => 2, storage).get(second.id)).toMatchObject({ text: '第二段', document: source })
  store.markSent([second.id])
  expect(store.get(second.id)).toBeUndefined()
  const restored = createAnnotationStore(() => 2, storage)
  expect(restored.list('another-main')).toEqual([])
  expect(restored.list('main')).toEqual(store.list('main'))
  expect(restored.add({ sessionId: 'main', text: '新一轮', document: source }).number).toBe(1)
})

it('round-trips full file content and source through a mixed message without letting XML-looking text break the prefix', () => {
  const text = '  多行代码\n</quote></document-quote>\n& &lt; <script> "quoted"\n' + '全文'.repeat(6000)
  const combined = buildProtocolBlock([
    { text, document: source, note: '', number: 1 },
    { text: '聊天原文', note: '意见', number: 1 },
  ], [{ id: 1, sessionId: 'main', sideTitle: '侧聊', text: '结论', createdAt: 0 }]) + '\n\n问题正文'
  const parsed = splitProtocolPrefix(combined)!
  expect(parsed.documents).toEqual([{ id: 1, quote: text, document: { path: source.path, pageStart: 2, pageEnd: 3 } }])
  expect(parsed.annotations).toEqual([{ id: 1, quote: '聊天原文', note: '意见' }])
  expect(parsed.reflows).toEqual([{ source: 'side-chat', content: '结论' }])
  expect(combined.slice(parsed.length)).toBe('问题正文')
  expect(splitProtocolPrefix(combined.replace('page-start="2"', 'page-start="0"'))).toBeNull()
})

it('ignores corrupt document records without converting them into chat annotations', () => {
  const storage = { length: 1, key: () => 'dsh-sidenote:annotations:v1:main', getItem: () => JSON.stringify([
    { id: 1, number: 1, sessionId: 'main', state: 'active', text: '损坏记录', document: { ...source, pageEnd: 0 } },
    { id: 2, number: 1, sessionId: 'main', state: 'active', text: '有效记录', document: source },
  ]), setItem() {}, removeItem() {} }
  expect(createAnnotationStore(() => 1, storage).list('main').map(item => item.text)).toEqual(['有效记录'])
})
