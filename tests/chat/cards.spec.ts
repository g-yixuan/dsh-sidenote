/**
 * chat/cards.ts（card union → 视图模型映射）单测：六种卡 + 三层判别 +
 * 未知卡 default 降级 + null 缺省 + cwd 解析。
 */
import { describe, expect, it } from 'vitest'
import { cardModelOf } from '../../src/client/chat/cards.ts'

describe('cardModelOf', () => {
  it('terminal：call 给标题/cwd/描述，result 给 output/exitCode（结果态覆盖标题）', () => {
    const model = cardModelOf({
      toolName: 'Bash',
      callView: { card: 'terminal', title: 'ls -1', description: '列目录', cwd: 'src' },
      resultView: { card: 'terminal', title: undefined, output: 'a\nb', exitCode: 0 },
      cwdBase: '/repo',
    })
    expect(model).toEqual({
      kind: 'terminal',
      title: 'ls -1',
      description: '列目录',
      cwd: '/repo/src',
      output: 'a\nb',
      exitCode: 0,
    })
  })

  it('terminal：绝对 cwd 不动；无 cwd 时用会话工作区；无 base 时相对原样', () => {
    const abs = cardModelOf({ toolName: 'Bash', callView: { card: 'terminal', title: 't', cwd: '/x' }, resultView: null })
    expect(abs).toMatchObject({ cwd: '/x' })
    const base = cardModelOf({ toolName: 'Bash', callView: { card: 'terminal', title: 't' }, resultView: null, cwdBase: '/repo' })
    expect(base).toMatchObject({ cwd: '/repo' })
    const rel = cardModelOf({ toolName: 'Bash', callView: { card: 'terminal', title: 't', cwd: 'src' }, resultView: null })
    expect(rel).toMatchObject({ cwd: 'src' })
  })

  it('diff：result 的 applied hunks 优先于 call 的参数推导 diff', () => {
    const model = cardModelOf({
      toolName: 'edit',
      callView: { card: 'diff', title: 'Write a.ts', diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] },
      resultView: { card: 'diff', title: 'Edited a.ts', diffs: [{ path: 'a.ts', oldText: 'y', newText: 'x' }] },
    })
    expect(model).toEqual({
      kind: 'diff',
      title: 'Edited a.ts',
      diffs: [{ path: 'a.ts', oldText: 'y', newText: 'x' }],
    })
  })

  it('generic：kind 图标 + rawInput + result content 正文；title 逐字段回退', () => {
    const model = cardModelOf({
      toolName: 'todo',
      callView: { card: 'generic', title: '写计划', kind: 'other', rawInput: { items: 3 } },
      resultView: { card: 'generic', content: [{ type: 'text', text: 'done' }] },
    })
    expect(model).toEqual({
      kind: 'generic',
      title: '写计划',
      icon: 'other',
      rawInput: { items: 3 },
      bodyText: 'done',
    })
  })

  it('null 双缺省 → generic 兜底卡（标题 = 工具名，正文 = rawText）', () => {
    const model = cardModelOf({ toolName: 'unknownTool', callView: null, resultView: null, rawText: '原始输出' })
    expect(model).toEqual({ kind: 'generic', title: 'unknownTool', icon: 'other', bodyText: '原始输出' })
  })

  it('search 二级判别 shape：matches → files；paths → paths', () => {
    const m = cardModelOf({
      toolName: 'grep',
      callView: { card: 'generic', title: '搜', kind: 'search' },
      resultView: { card: 'search', shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 3, line: 'hit' }] }], truncated: false, total: 1 },
    })
    expect(m).toMatchObject({ kind: 'search', shape: 'matches', total: 1 })
    const p = cardModelOf({
      toolName: 'glob',
      callView: { card: 'generic', title: '找', kind: 'search' },
      resultView: { card: 'search', shape: 'paths', paths: ['a.ts'], truncated: true, total: 50 },
    })
    expect(p).toMatchObject({ kind: 'search', shape: 'paths', truncated: true, total: 50 })
  })

  it('read：行号/总数/语言直达', () => {
    const model = cardModelOf({
      toolName: 'read',
      callView: { card: 'generic', title: 'README.md', kind: 'read' },
      resultView: { card: 'read', path: 'README.md', offset: 1, lines: [{ number: 1, text: '# t' }], totalLines: 10, lang: 'md' },
    })
    expect(model).toMatchObject({ kind: 'read', path: 'README.md', totalLines: 10, lang: 'md' })
  })

  it('web 二级判别 kind：search 带 sources；fetch 带 url/statusCode', () => {
    const s = cardModelOf({
      toolName: 'web_search',
      callView: null,
      resultView: { card: 'web', kind: 'search', sources: [{ url: 'https://a' }], answer: '答案', truncated: false },
    })
    expect(s).toMatchObject({ kind: 'web', webKind: 'search', answer: '答案' })
    const f = cardModelOf({
      toolName: 'web_fetch',
      callView: null,
      resultView: { card: 'web', kind: 'fetch', url: 'https://a', statusCode: 200, truncated: false },
    })
    expect(f).toMatchObject({ kind: 'web', webKind: 'fetch', statusCode: 200 })
  })

  it('未知 card 值 → default 降级 generic + warn-once（不抛不炸）', () => {
    const weird = { card: 'hologram', title: '全息卡' }
    const model = cardModelOf({ toolName: 'newTool', callView: weird as never, resultView: null, rawText: '兜底正文' })
    expect(model).toMatchObject({ kind: 'generic', title: 'newTool', bodyText: '兜底正文' })
    // 第二次同值不再 warn（warn-once；此处不断言 console，只验证不抛）
    expect(() => cardModelOf({ toolName: 'newTool', callView: weird as never, resultView: null })).not.toThrow()
  })

  it('未知 shape/kind 二级判别 → default 降级 generic', () => {
    const weird = { card: 'search', shape: 'clusters', paths: [] }
    const model = cardModelOf({ toolName: 'grep', callView: null, resultView: weird as never, rawText: 'raw' })
    expect(model.kind).toBe('generic')
  })
})
