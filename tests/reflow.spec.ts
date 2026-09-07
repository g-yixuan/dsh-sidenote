/**
 * 回流通道单测（纯函数，node 环境）：
 * - 受控 store：问答成对的存取、localStorage 持久化 revive、clearSession。
 * - buildReflowBlock：<问>/<答> XML 形态（有问成对、无问仅答、空白问视为无）。
 * - pairQuestions：assistant 消息与最近用户提问的配对（协议前缀剥离、
 *   tool 节点不打断、流式不配、无提问不配）。
 * - flattenReflowContent：tooltip 展示剥标签。
 */
import { describe, expect, it } from 'vitest'
import { buildReflowBlock, createReflowStore } from '../src/client/reflow.ts'
import { flattenReflowContent } from '../src/client/annotate/format.ts'
import { pairQuestions } from '../src/client/sidechat/model.ts'
import type { ChatMessage } from '../src/client/chat/transcript.ts'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

const user = (key: string, text: string): ChatMessage => ({ key, role: 'user', text })
const assistant = (key: string, text: string, streaming = false): ChatMessage =>
  ({ key, role: 'assistant', text, ...(streaming ? { streaming: true } : {}) })
const tool = (key: string): ChatMessage => ({ key, role: 'tool', text: '', toolName: 'Bash' })

describe('buildReflowBlock（问答成对 XML）', () => {
  const base = { id: 1, sessionId: 's1', sideTitle: '侧边 2', createdAt: 0 }

  it('有提问时 <问> 在 <答> 前，包裹在 <reflow> 块内', () => {
    const block = buildReflowBlock({ ...base, text: '答全文', question: '问全文' })
    expect(block).toContain('<reflow source="侧边 2"')
    expect(block).toContain('<问>问全文</问>')
    expect(block).toContain('<答>答全文</答>')
    expect(block.indexOf('<问>')).toBeLessThan(block.indexOf('<答>'))
    expect(block.trimEnd().endsWith('</reflow>')).toBe(true)
  })

  it('无提问时只有 <答>（fork 历史结尾等场景）', () => {
    const block = buildReflowBlock({ ...base, text: '答全文' })
    expect(block).not.toContain('<问>')
    expect(block).toContain('<答>答全文</答>')
  })

  it('全空白提问按无提问处理', () => {
    const block = buildReflowBlock({ ...base, text: '答全文', question: '  \n ' })
    expect(block).not.toContain('<问>')
  })
})

describe('reflow store（问答成对的存取与持久化）', () => {
  it('add 存 question；空白 question 归一为缺省', () => {
    const store = createReflowStore(() => 1, memoryStorage())
    const withQ = store.add('s1', '侧边', '答一', '问一')
    const withoutQ = store.add('s1', '侧边', '答二', '   ')
    expect(store.list('s1').find(i => i.id === withQ.id)?.question).toBe('问一')
    expect(store.list('s1').find(i => i.id === withoutQ.id)?.question).toBeUndefined()
  })

  it('localStorage revive 恢复 question（刷新不丢问答对）', () => {
    const mem = memoryStorage()
    createReflowStore(() => 1, mem).add('s1', '侧边', '答全文', '问全文')
    const revived = createReflowStore(() => 2, mem)
    const item = revived.list('s1')[0]
    expect(item?.text).toBe('答全文')
    expect(item?.question).toBe('问全文')
    // revive 后序列化仍成对
    expect(buildReflowBlock(item!)).toContain('<问>问全文</问>')
  })

  it('clearSession 清空该会话（含 question），其他会话不受影响', () => {
    const mem = memoryStorage()
    const store = createReflowStore(() => 1, mem)
    store.add('s1', '侧边', '答一', '问一')
    store.add('s2', '侧边', '答二', '问二')
    store.clearSession('s1')
    expect(store.list('s1')).toEqual([])
    expect(store.list('s2')[0]?.question).toBe('问二')
    // 空会话键已删除（空删键纪律）
    expect(mem.getItem('dsh-sidenote:reflow:v1:s1')).toBeNull()
    expect(mem.getItem('dsh-sidenote:reflow:v1:s2')).not.toBeNull()
  })
})

describe('pairQuestions（assistant ↔ 最近用户提问）', () => {
  it('基本配对：assistant 取最近一条用户消息全文', () => {
    const pairs = pairQuestions([
      user('u:1', '第一个问题'),
      assistant('a:1', '回答一'),
      user('u:2', '第二个问题'),
      assistant('a:2', '回答二'),
    ])
    expect(pairs.get('a:1')).toBe('第一个问题')
    expect(pairs.get('a:2')).toBe('第二个问题')
  })

  it('剥离协议前缀：fork 历史里带注释/回流块的用户消息取可见正文', () => {
    const withReflow = '<reflow source="侧边 1" reason="r">\n<答>旧结论</答>\n</reflow>\n\n真正的问题'
    const withAnnotation = '我批注了以下 1 处内容：\n<annotation id="1">\n<quote>引用</quote>\n</annotation>\n\n批注后的提问'
    const pairs = pairQuestions([
      user('u:1', withReflow),
      assistant('a:1', '回答一'),
      user('u:2', withAnnotation),
      assistant('a:2', '回答二'),
    ])
    expect(pairs.get('a:1')).toBe('真正的问题')
    expect(pairs.get('a:2')).toBe('批注后的提问')
  })

  it('tool/notice 节点不打断配对（提问 → 工具 → 回答）', () => {
    const pairs = pairQuestions([
      user('u:1', '问题'),
      tool('t:1'),
      assistant('a:1', '回答'),
    ])
    expect(pairs.get('a:1')).toBe('问题')
  })

  it('流式中的 assistant 不配对；此前无用户提问不配对', () => {
    const pairs = pairQuestions([
      user('u:1', '问题'),
      assistant('a:1', '流式中', true),
    ])
    expect(pairs.has('a:1')).toBe(false)
    const orphan = pairQuestions([assistant('a:9', 'fork 历史结尾的回答')])
    expect(orphan.has('a:9')).toBe(false)
  })

  it('纯协议前缀（无可见正文）的提问视为无提问', () => {
    const pairs = pairQuestions([
      user('u:1', '<reflow source="侧边 1" reason="r">\n<答>只有协议块</答>\n</reflow>'),
      assistant('a:1', '回答'),
    ])
    expect(pairs.has('a:1')).toBe(false)
  })
})

describe('flattenReflowContent（tooltip 展示剥标签）', () => {
  it('<问>/<答> 标签剥离、内容保留', () => {
    const flat = flattenReflowContent('<问>多行\n提问</问>\n<答>结论</答>')
    expect(flat).toBe('多行\n提问\n结论')
  })

  it('无标签内容原样返回', () => {
    expect(flattenReflowContent('纯文本')).toBe('纯文本')
  })
})
