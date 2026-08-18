/**
 * Workitem 02 纯函数单测：注释 store（增删 / 编号不重排 / 计数 / 发送沿）、
 * 引用块格式化（发送给模型的数据形态）、截断、选区校验、受管草稿前缀数学。
 * 全部为 node 环境的纯函数测试（无 jsdom 依赖）。
 */
import { describe, expect, it } from 'vitest'
import { createAnnotationStore } from '../src/client/annotate/model.ts'
import type { AnnotationDraft } from '../src/client/annotate/model.ts'
import {
  SELECTION_LIMIT,
  TRUNCATION_MARK,
  buildQuoteBlock,
  buildSideChatQuote,
  isSendEdge,
  nextManagedDraft,
  quoteLines,
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

describe('quote formatting', () => {
  it('truncates over-limit quotes with the truncation mark', () => {
    const long = 'x'.repeat(SELECTION_LIMIT + 10)
    const out = truncateQuote(long)
    expect(out).toBe('x'.repeat(SELECTION_LIMIT) + TRUNCATION_MARK)
    expect(truncateQuote('short')).toBe('short')
    expect(truncateQuote('x'.repeat(SELECTION_LIMIT))).toBe('x'.repeat(SELECTION_LIMIT))
  })

  it('quotes multi-line text with > on every line', () => {
    expect(quoteLines('第一行\n第二行')).toBe('> 第一行\n> 第二行')
    expect(quoteLines('a\n\nb')).toBe('> a\n>\n> b')
  })

  it('builds the model-facing block: > 原文 + 注解 line, joined by blank lines', () => {
    const block = buildQuoteBlock([
      { text: '原文片段 1', note: 'xxx' },
      { text: '原文片段 2', note: '' },
    ])
    expect(block).toBe('> 原文片段 1\nNote: xxx\n\n> 原文片段 2\n(no note)')
  })

  it('returns an empty block for no annotations', () => {
    expect(buildQuoteBlock([])).toBe('')
  })

  it('builds the side-chat seed as quote + note line（与主对话注释同构）', () => {
    expect(buildSideChatQuote('划选的\n文本')).toBe('> 划选的\n> 文本\n(no note)')
    expect(buildSideChatQuote('划选的文本', '关注这里')).toBe('> 划选的文本\nNote: 关注这里')
  })
})

describe('managed draft prefix math', () => {
  it('prepends the head to an empty draft', () => {
    const next = nextManagedDraft('', '', '> 原文\n(no note)')
    expect(next).toEqual({ head: '> 原文\n(no note)\n\n', draft: '> 原文\n(no note)\n\n' })
  })

  it('preserves user text below the head across block updates', () => {
    const first = nextManagedDraft('', '', '> 原文 1\n(no note)')
    const typed = `${first.draft}用户正文`
    const second = nextManagedDraft(typed, first.head, '> 原文 1\nNote: 改')
    expect(second.draft).toBe('> 原文 1\nNote: 改\n\n用户正文')
  })

  it('removes the head cleanly when the block empties (all sent/deleted)', () => {
    const first = nextManagedDraft('', '', '> 原文\n(no note)')
    const typed = `${first.draft}用户正文`
    const cleared = nextManagedDraft(typed, first.head, '')
    expect(cleared).toEqual({ head: '', draft: '用户正文' })
  })

  it('treats a meddled head as user text instead of crashing', () => {
    const next = nextManagedDraft('用户把头部改掉了', '> 旧头\n\n', '> 新头\n（无注解）')
    expect(next.draft).toBe('> 新头\n（无注解）\n\n用户把头部改掉了')
  })
})

describe('send edge', () => {
  it('fires on non-empty → empty and on non-empty → whitespace', () => {
    expect(isSendEdge('草稿', '')).toBe(true)
    expect(isSendEdge('草稿', '  \n')).toBe(true)
  })
  it('ignores every other transition', () => {
    expect(isSendEdge('', '')).toBe(false)
    expect(isSendEdge('', 'x')).toBe(false)
    expect(isSendEdge('a', 'b')).toBe(false)
    expect(isSendEdge('a', 'ab')).toBe(false)
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
