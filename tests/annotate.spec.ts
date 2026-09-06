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
  buildProtocolBlock,
  buildSideChatQuote,
  splitProtocolPrefix,
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

describe('protocol block v3（XML 形态）', () => {
  it('builds header + annotation XML blocks（无注解省略 <note>）', () => {
    const block = buildProtocolBlock([
      { text: '原文片段 1', note: 'xxx', number: 1 },
      { text: '多行\n原文', note: '', number: 2 },
    ])
    expect(block).toBe(
      'I annotated 2 passage(s) of the conversation above:\n'
      + '<annotation id="1">\n<quote>原文片段 1</quote>\n<note>xxx</note>\n</annotation>\n'
      + '<annotation id="2">\n<quote>多行\n原文</quote>\n</annotation>',
    )
  })

  it('嵌套消歧：引用内容自身含「」/markdown 不影响解析', () => {
    const block = buildProtocolBlock([{ text: '这里有「内层引号」和 > 引用符', note: '注', number: 3 }])
    const msg = `${block}\n\n我的问题`
    const parsed = splitProtocolPrefix(msg)
    expect(parsed).not.toBeNull()
    expect(parsed!.annotations).toHaveLength(1)
    expect(parsed!.annotations[0]).toEqual({ id: 3, quote: '这里有「内层引号」和 > 引用符', note: '注' })
  })

  it('前缀反解析：注释+正文、正文留白边界正确', () => {
    const block = buildProtocolBlock([{ text: 'A', note: '', number: 1 }])
    const parsed = splitProtocolPrefix(`${block}\n\n正文内容`)
    expect(parsed).not.toBeNull()
    expect(parsed!.annotations).toEqual([{ id: 1, quote: 'A', note: '' }])
    expect((`${block}\n\n正文内容`).slice(parsed!.length)).toBe('正文内容')
  })

  it('普通消息不误判', () => {
    expect(splitProtocolPrefix('随便聊聊')).toBeNull()
    expect(splitProtocolPrefix('我批注了以下 2 处内容：\n但没有 XML 块')).toBeNull()
    expect(splitProtocolPrefix('')).toBeNull()
  })

  it('回流块前缀一并反解析（回流在前、注释在后）', () => {
    const msg = '<reflow source="Side 2" reason="r">\n结论全文\n</reflow>\n\n'
      + buildProtocolBlock([{ text: 'A', note: 'n', number: 1 }]) + '\n\n正文'
    const parsed = splitProtocolPrefix(msg)
    expect(parsed).not.toBeNull()
    expect(parsed!.reflows).toEqual([{ source: 'Side 2', content: '结论全文' }])
    expect(parsed!.annotations).toHaveLength(1)
    expect(msg.slice(parsed!.length)).toBe('正文')
  })

  it('protocol header regex matches both locales, rejects lookalikes', () => {
    expect(PROTOCOL_HEADER_RE.test('我批注了以下 2 处内容：')).toBe(true)
    expect(PROTOCOL_HEADER_RE.test('I annotated 1 passage(s) of the conversation above:')).toBe(true)
    expect(PROTOCOL_HEADER_RE.test('我批注了以下 2 处内容')).toBe(false)
    expect(PROTOCOL_HEADER_RE.test('随便一句 我批注了以下 2 处内容：')).toBe(false)
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
