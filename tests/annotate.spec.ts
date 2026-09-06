/**
 * 纯函数单测：注释 store（增删 / 编号不重排 / 计数 / sent 迁移 / 持久化）、
 * 协议块 v2 序列化与反解析（发送给模型的数据形态）、截断、选区校验。
 * 全部为 node 环境的纯函数测试（无 jsdom 依赖）。
 */
import { describe, expect, it } from 'vitest'
import { createAnnotationStore } from '../src/client/annotate/model.ts'
import type { AnnotationDraft } from '../src/client/annotate/model.ts'
import {
  PROTOCOL_HEADER_RE,
  SELECTION_LIMIT,
  TRUNCATION_MARK,
  buildProtocolBlock,
  buildSideChatQuote,
  flattenQuote,
  parseProtocolItem,
  truncateQuote,
} from '../src/client/annotate/format.ts'
import { ASSISTANT_KIND, isEligibleSelection } from '../src/client/annotate/selection.ts'
import { BADGE_SPREAD_STEP, spreadBadgePoint } from '../src/client/annotate/anchor.ts'

function draft(sessionId: string, text: string, note = ''): AnnotationDraft {
  return { sessionId, anchorKey: 'k1', text, anchorText: text, occurrence: 0, note }
}

describe('annotation store', () => {
  it('assigns per-session numbers in creation order, starting at 1', () => {
    const store = createAnnotationStore()
    const a1 = store.add(draft('s1', '甲'))
    const a2 = store.add(draft('s1', '乙'))
    const b1 = store.add(draft('s2', '丙'))
    expect([a1.number, a2.number]).toEqual([1, 2])
    expect(b1.number).toBe(1)
    expect(new Set([a1.id, a2.id, b1.id]).size).toBe(3)
  })

  it('does not renumber after deletion (删除不重排)', () => {
    const store = createAnnotationStore()
    store.add(draft('s1', '一'))
    const second = store.add(draft('s1', '二'))
    store.remove(store.list('s1')[0]!.id)
    expect(store.list('s1').map(a => a.number)).toEqual([2])
    // 新建继续递增，不复用已删除的编号
    const third = store.add(draft('s1', '三'))
    expect(third.number).toBe(3)
    expect(second.number).toBe(2)
  })

  it('counts only active annotations per session (chip count)', () => {
    const store = createAnnotationStore()
    store.add(draft('s1', '一'))
    store.add(draft('s1', '二'))
    store.add(draft('s2', '三'))
    expect(store.countActive('s1')).toBe(2)
    expect(store.countActive('s2')).toBe(1)
    expect(store.countActive('nope')).toBe(0)
  })

  it('markSessionSent flips active → sent: chip clears, badges stay listed', () => {
    const store = createAnnotationStore()
    store.add(draft('s1', '一'))
    store.add(draft('s1', '二'))
    store.markSessionSent('s1')
    expect(store.countActive('s1')).toBe(0)
    expect(store.list('s1')).toHaveLength(2)
    expect(store.list('s1').every(a => a.state === 'sent')).toBe(true)
    // 幂等：再次 markSent 不再变化
    const version = store.getSnapshot()
    store.markSessionSent('s1')
    expect(store.getSnapshot()).toBe(version)
  })

  it('setNote updates the note and tolerates unknown ids', () => {
    const store = createAnnotationStore()
    const a = store.add(draft('s1', '原文', ''))
    store.setNote(a.id, '这是我的注解')
    expect(store.get(a.id)?.note).toBe('这是我的注解')
    const version = store.getSnapshot()
    store.setNote(999, 'x')
    expect(store.getSnapshot()).toBe(version)
  })

  it('notifies subscribers on every mutation', () => {
    const store = createAnnotationStore()
    let calls = 0
    const off = store.subscribe(() => { calls += 1 })
    const a = store.add(draft('s1', '一'))
    store.setNote(a.id, 'n')
    store.remove(a.id)
    expect(calls).toBe(3)
    off()
    store.add(draft('s1', '二'))
    expect(calls).toBe(3)
  })
})

describe('protocol block v2', () => {
  it('truncates over-limit quotes with the truncation mark', () => {
    const long = 'x'.repeat(SELECTION_LIMIT + 10)
    const out = truncateQuote(long)
    expect(out).toBe('x'.repeat(SELECTION_LIMIT) + TRUNCATION_MARK)
    expect(truncateQuote('short')).toBe('short')
  })

  it('flattens multi-line quotes to a single line (⏎)', () => {
    expect(flattenQuote('第一行\n第二行')).toBe('第一行⏎第二行')
  })

  it('builds header + numbered lines (model-facing wire format)', () => {
    const block = buildProtocolBlock([
      { text: '原文片段 1', note: 'xxx' },
      { text: '多行\n原文', note: '' },
    ])
    expect(block).toBe(
      'I annotated 2 passage(s) of the conversation above:\n'
      + '1. 「原文片段 1」Note: xxx\n'
      + '2. 「多行⏎原文」(no note)',
    )
  })

  it('protocol header regex matches both locales, rejects lookalikes', () => {
    expect(PROTOCOL_HEADER_RE.test('我批注了以下 2 处内容：')).toBe(true)
    expect(PROTOCOL_HEADER_RE.test('I annotated 1 passage(s) of the conversation above:')).toBe(true)
    expect(PROTOCOL_HEADER_RE.test('我批注了以下 2 处内容')).toBe(false) // 缺冒号
    expect(PROTOCOL_HEADER_RE.test('随便一句 我批注了以下 2 处内容：')).toBe(false)
  })

  it('parses protocol items back (round-trip, both locales)', () => {
    expect(parseProtocolItem('「引用」Note: 改这里')).toEqual({ quote: '引用', note: '改这里' })
    expect(parseProtocolItem('「引用」注解：改这里')).toEqual({ quote: '引用', note: '改这里' })
    expect(parseProtocolItem('「引用」(no note)')).toEqual({ quote: '引用', note: '' })
    expect(parseProtocolItem('「引用」（无注解）')).toEqual({ quote: '引用', note: '' })
    expect(parseProtocolItem('没有括号')).toBeNull()
  })

  it('builds the side-chat seed as quote + note line（轻量、非协议块）', () => {
    expect(buildSideChatQuote('划选的\n文本')).toBe('> 划选的\n> 文本\n(no note)')
    expect(buildSideChatQuote('划选的文本', '关注这里')).toBe('> 划选的文本\nNote: 关注这里')
  })
})

describe('store 持久化（localStorage 注入替身）', () => {
  function fakeStorage() {
    const map = new Map<string, string>()
    return {
      get length() { return map.size },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
      map,
    }
  }

  it('mutation 后按会话落盘，清空后删键', () => {
    const storage = fakeStorage()
    const store = createAnnotationStore(() => 1, storage)
    const a = store.add(draft('s1', '原文', '注'))
    expect(storage.map.size).toBe(1)
    store.remove(a.id)
    expect(storage.map.size).toBe(0)
  })

  it('刷新后水合恢复：编号续接、状态保留', () => {
    const storage = fakeStorage()
    const first = createAnnotationStore(() => 1, storage)
    first.add(draft('s1', '甲'))
    const b = first.add(draft('s1', '乙', '注'))
    first.markSessionSent('s1')
    const second = createAnnotationStore(() => 2, storage)
    expect(second.list('s1')).toHaveLength(2)
    expect(second.list('s1').every(a => a.state === 'sent')).toBe(true)
    // 编号续接（不复用 1/2）
    const c = second.add(draft('s1', '丙'))
    expect(c.number).toBe(3)
    // id 也不与水合的撞车
    expect(c.id).toBeGreaterThan(b.id)
  })

  it('畸形持久化数据被容错丢弃', () => {
    const storage = fakeStorage()
    storage.setItem('dsh-sidenote:annotations:v1:s1', JSON.stringify([{ bogus: true }, null]))
    storage.setItem('dsh-sidenote:annotations:v1:s2', 'not json')
    const store = createAnnotationStore(() => 1, storage)
    expect(store.list('s1')).toHaveLength(0)
    expect(store.list('s2')).toHaveLength(0)
  })
})

describe('selection eligibility', () => {
  const ok = {
    blank: false,
    sameMessage: true,
    kind: ASSISTANT_KIND,
    streaming: false,
    excluded: false,
    hasSession: true,
  }
  it('accepts a valid assistant-message selection', () => {
    expect(isEligibleSelection(ok)).toBe(true)
    expect(ASSISTANT_KIND).toBe('assistant-step')
  })
  it('rejects blank, cross-message, non-assistant, streaming, excluded, session-less', () => {
    expect(isEligibleSelection({ ...ok, blank: true })).toBe(false)
    expect(isEligibleSelection({ ...ok, sameMessage: false })).toBe(false)
    expect(isEligibleSelection({ ...ok, kind: 'user' })).toBe(false)
    expect(isEligibleSelection({ ...ok, kind: 'assistant' })).toBe(false) // v1 旧值，勿回退
    expect(isEligibleSelection({ ...ok, streaming: true })).toBe(false)
    expect(isEligibleSelection({ ...ok, excluded: true })).toBe(false)
    expect(isEligibleSelection({ ...ok, hasSession: false })).toBe(false)
  })
})

describe('badge spreading (同点位角标错开)', () => {
  it('keeps a non-colliding point untouched', () => {
    expect(spreadBadgePoint({ x: 100, y: 100 }, [])).toEqual({ x: 100, y: 100 })
    expect(spreadBadgePoint({ x: 100, y: 100 }, [{ x: 300, y: 300 }])).toEqual({ x: 100, y: 100 })
  })
  it('spreads colliding badges downward by the step', () => {
    const first = { x: 100, y: 100 }
    const second = spreadBadgePoint({ x: 100, y: 100 }, [first])
    expect(second).toEqual({ x: 100, y: 100 + BADGE_SPREAD_STEP })
    const third = spreadBadgePoint({ x: 100, y: 100 }, [first, second])
    expect(third).toEqual({ x: 100, y: 100 + BADGE_SPREAD_STEP * 2 })
  })
  it('does not collide with far-away badges', () => {
    const placed = [{ x: 100, y: 100 }, { x: 100, y: 100 + BADGE_SPREAD_STEP }]
    expect(spreadBadgePoint({ x: 100, y: 400 }, placed)).toEqual({ x: 100, y: 400 })
  })
})
