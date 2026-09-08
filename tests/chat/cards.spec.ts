/**
 * chat/cards.ts（card union → 视图模型映射）单测：六种卡 + 三层判别 +
 * 未知卡 default 降级 + null 缺省 + cwd 解析。
 */
import { describe, expect, it } from 'vitest'
import { cardModelFromNode, cardModelOf } from '../../src/client/chat/cards.ts'

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
      // 有 description：标题让位人话（「Bash · 描述」），命令原文随 command 行进 TerminalBlock。
      title: 'Bash · 列目录',
      command: 'ls -1',
      description: '列目录',
      cwd: '/repo/src',
      output: 'a\nb',
      exitCode: 0,
    })
  })

  it('terminal：无 description 时标题 = 命令原文', () => {
    const model = cardModelOf({
      toolName: 'Bash',
      callView: { card: 'terminal', title: 'ls -1' },
      resultView: null,
    })
    expect(model).toMatchObject({ kind: 'terminal', title: 'ls -1', command: 'ls -1' })
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

  it('todo_write（wire 面）→ todo 卡：rawInput = todos 数组本身（dsh-tool-todo presentCall 实证形状）', () => {
    const model = cardModelOf({
      toolName: 'todo_write',
      callView: { card: 'generic', title: 'Update todo list', kind: 'other', rawInput: [{ content: '甲', status: 'completed' }, { content: '乙', status: 'pending' }] },
      resultView: null,
    })
    expect(model).toMatchObject({ kind: 'todo', title: 'Tasks · 1 done · 1 pending' })
  })

  it('displayTitle：「Tool /abs/path」→「Tool · 末3段」；裸路径/无路径原样', () => {
    expect(cardModelOf({
      toolName: 'read',
      callView: null,
      resultView: { card: 'read', title: 'Read /Users/x/a/b/c/d.ts', path: '/Users/x/a/b/c/d.ts', offset: 1, lines: [{ number: 1, text: 'x' }], totalLines: 1 },
    })).toMatchObject({ title: 'Read · b/c/d.ts' })
    // 不含路径的标题不动
    expect(cardModelOf({ toolName: 'unknownTool', callView: null, resultView: null, rawText: 'r' }))
      .toMatchObject({ title: 'unknownTool' })
  })
})

describe('cardModelFromNode（0.1.2 推导路径：callView 移除后的客户端推导）', () => {
  it('bash：argsRaw.command 作标题，尾标剥成 output+exitCode', () => {
    const model = cardModelFromNode({
      name: 'bash',
      argsRaw: '{"command":"ls -1","description":"列目录"}',
      rawText: 'README.md\npackage.json\n\n[exit code: 0]',
    })
    expect(model).toEqual({
      kind: 'terminal',
      title: 'Bash · 列目录',
      command: 'ls -1',
      description: '列目录',
      output: 'README.md\npackage.json',
      exitCode: 0,
    })
  })

  it('bash：signal 尾标与无尾标原样', () => {
    expect(cardModelFromNode({ name: 'bash', argsRaw: '{"command":"x"}', rawText: 'partial\n[killed by signal: SIGTERM]' }))
      .toMatchObject({ kind: 'terminal', output: 'partial', signal: 'SIGTERM' })
    expect(cardModelFromNode({ name: 'bash', argsRaw: '{"command":"x"}', rawText: 'plain' }))
      .toMatchObject({ kind: 'terminal', output: 'plain' })
    expect(cardModelFromNode({ name: 'bash', argsRaw: '{"command":"x"}', rawText: 'plain' })).not.toHaveProperty('exitCode')
  })

  it('read：meta 过校验 → read 卡（标题 Read <path>）；meta 坏 → generic 降级', () => {
    const good = cardModelFromNode({
      name: 'read',
      meta: { path: 'README.md', offset: 1, lines: [{ number: 1, text: '# x' }], totalLines: 3, lang: 'md' },
      rawText: '<path>README.md</path>...',
    })
    expect(good).toMatchObject({ kind: 'read', title: 'Read · README.md', totalLines: 3, lang: 'md' })
    // 行号越界（>totalLines）→ 语义校验拒收 → 降级
    const bad = cardModelFromNode({
      name: 'read',
      meta: { path: 'a.ts', offset: 1, lines: [{ number: 99, text: 'x' }], totalLines: 3 },
      rawText: 'raw',
    })
    expect(bad.kind).toBe('generic')
  })

  it('edit：generic 卡 + 路径入标题；未知工具：名为题', () => {
    expect(cardModelFromNode({ name: 'edit', argsRaw: '{"file_path":"a.ts"}', rawText: '' }))
      .toMatchObject({ kind: 'generic', title: 'edit · a.ts', icon: 'edit' })
    expect(cardModelFromNode({ name: 'mystery', rawText: 'out' }))
      .toMatchObject({ kind: 'generic', title: 'mystery', icon: 'other', bodyText: 'out' })
  })

  it('argsRaw 非 JSON / 缺字段不炸', () => {
    expect(cardModelFromNode({ name: 'bash', argsRaw: 'not json', rawText: '' }).kind).toBe('terminal')
    expect(cardModelFromNode({ name: 'bash', argsRaw: undefined, rawText: '' })).toMatchObject({ title: 'bash' })
  })

  // ── 0.1.2 全保真三卡（meta 逆向落地，/tmp/recon-meta012.md 证据）──

  it('edit → diff 卡：meta.diffs 透传 + 标题「Edit · 末3段」+ locations 重建', () => {
    const model = cardModelFromNode({
      name: 'edit',
      argsRaw: '{"file_path":"/Users/x/gyx/dsh-sidenote/src/a.ts","old_string":"a","new_string":"b"}',
      meta: { diffs: [{ path: '/Users/x/gyx/dsh-sidenote/src/a.ts', oldText: 'a', newText: 'b' }] },
      rawText: '',
    })
    expect(model).toMatchObject({
      kind: 'diff',
      title: 'Edit · dsh-sidenote/src/a.ts',
      diffs: [{ path: '/Users/x/gyx/dsh-sidenote/src/a.ts', oldText: 'a', newText: 'b' }],
      locations: [{ path: '/Users/x/gyx/dsh-sidenote/src/a.ts' }],
    })
  })

  it('write → diff 卡：meta 空数组回退 args 整文件 diff（create 语义）；isError 不回退', () => {
    const created = cardModelFromNode({
      name: 'write',
      argsRaw: '{"file_path":"/r/p/new.ts","content":"hello"}',
      meta: { diffs: [] },
      rawText: '',
    })
    expect(created).toMatchObject({
      kind: 'diff',
      diffs: [{ path: '/r/p/new.ts', oldText: null, newText: 'hello' }],
    })
    // 失败的 write 无 meta——绝不能被回退渲染成 diff 卡
    expect(cardModelFromNode({
      name: 'write',
      argsRaw: '{"file_path":"/r/p/new.ts","content":"hello"}',
      rawText: 'Error: EACCES',
      isError: true,
    }).kind).toBe('generic')
    // edit 缺 meta → 降级（edit 无回退路径）
    expect(cardModelFromNode({
      name: 'edit',
      argsRaw: '{"file_path":"/r/a.ts","old_string":"a","new_string":"b"}',
      rawText: '',
    }).kind).toBe('generic')
  })

  it('diff 卡 meta 一项违规整卡降级 generic', () => {
    expect(cardModelFromNode({
      name: 'edit',
      argsRaw: '{"file_path":"/r/a.ts","old_string":"a","new_string":"b"}',
      meta: { diffs: [{ path: '/r/a.ts', oldText: 1, newText: 'b' }] },
      rawText: '',
    }).kind).toBe('generic')
  })

  it('grep → search 卡（matches 形态 + 标题 Grep p in path (inc)）；shape 与工具名不匹配即降级', () => {
    const model = cardModelFromNode({
      name: 'grep',
      argsRaw: '{"pattern":"TODO","path":"/Users/x/gyx/dsh-sidenote/src","include":"*.ts"}',
      meta: { shape: 'matches', files: [{ path: 'src/a.ts', matches: [{ lineNumber: 3, line: '// TODO' }] }], truncated: false, total: 1 },
      rawText: '',
    })
    expect(model).toMatchObject({
      kind: 'search', shape: 'matches',
      title: 'Grep TODO in gyx/dsh-sidenote/src (*.ts)',
      total: 1, truncated: false,
    })
    // shape 交叉校验：grep 拿到 paths → 降级
    expect(cardModelFromNode({
      name: 'grep',
      argsRaw: '{"pattern":"x"}',
      meta: { shape: 'paths', paths: ['a'], truncated: false, total: 1 },
      rawText: '',
    }).kind).toBe('generic')
  })

  it('glob → search 卡（paths 形态，空结果合法）；truncated/total 硬校验', () => {
    expect(cardModelFromNode({
      name: 'glob',
      argsRaw: '{"pattern":"**/*.ts"}',
      meta: { shape: 'paths', paths: [], truncated: false, total: 0 },
      rawText: '',
    })).toMatchObject({ kind: 'search', shape: 'paths', title: 'Glob **/*.ts', total: 0 })
    // total 缺失 → 降级
    expect(cardModelFromNode({
      name: 'glob',
      argsRaw: '{"pattern":"**/*.ts"}',
      meta: { shape: 'paths', paths: ['a'], truncated: false },
      rawText: '',
    }).kind).toBe('generic')
  })

  it('web_search → web 卡（sources 校验 + publishedAt 降采样丢弃 + answer 透传）', () => {
    const model = cardModelFromNode({
      name: 'web_search',
      argsRaw: '{"queries":["dsh plugin","deepseek harness"]}',
      meta: { sources: [{ url: 'https://a.dev', title: 'A', publishedAt: '2026' }, { url: 'https://b.dev' }], truncated: false, answer: '答案' },
      rawText: '',
    })
    expect(model).toMatchObject({
      kind: 'web', webKind: 'search',
      title: 'dsh plugin, deepseek harness',
      sources: [{ url: 'https://a.dev', title: 'A' }, { url: 'https://b.dev' }],
      answer: '答案',
    })
    // sources[0] 不带 publishedAt（降采样丢弃）
    expect(model.kind === 'web' && model.sources?.[0]).not.toHaveProperty('publishedAt')
  })

  it('web_fetch → web 卡（fetch 形态）；statusCode 非整数降级', () => {
    expect(cardModelFromNode({
      name: 'web_fetch',
      argsRaw: '{"url":"https://a.dev/x"}',
      meta: { url: 'https://a.dev/x', statusCode: 200, truncated: false },
      rawText: '',
    })).toMatchObject({ kind: 'web', webKind: 'fetch', title: 'https://a.dev/x', statusCode: 200 })
    expect(cardModelFromNode({
      name: 'web_fetch',
      argsRaw: '{"url":"https://a.dev/x"}',
      meta: { url: 'https://a.dev/x', statusCode: 20.5, truncated: false },
      rawText: '',
    }).kind).toBe('generic')
  })

  it('KIND_BY_NAME 回归：str_replace_editor（下划线 wire 名）与 web_search（kind=search）', () => {
    expect(cardModelFromNode({ name: 'str_replace_editor', argsRaw: '{"path":"/r/a.ts"}', rawText: '' }))
      .toMatchObject({ kind: 'generic', icon: 'edit' })
    // web_search 缺 meta 降级 generic 时图标应为 search 族
    expect(cardModelFromNode({ name: 'web_search', rawText: 'x' }))
      .toMatchObject({ kind: 'generic', icon: 'search' })
  })

  it('read：绝对路径标题缩短为末 3 段（主区「Read · 仓相对路径」同款）', () => {
    const model = cardModelFromNode({
      name: 'read',
      meta: { path: '/Users/x/gyx_personal_files/dsh_project/dsh-sidenote/scripts/e2e-mount.sh', lines: [{ number: 1, text: 'x' }], totalLines: 1 },
      rawText: 'x',
    })
    expect(model).toMatchObject({ kind: 'read', title: 'Read · dsh-sidenote/scripts/e2e-mount.sh' })
  })

  it('todo_write → todo 卡（标题带非零状态计数；node 环境词典 = en）', () => {
    const model = cardModelFromNode({
      name: 'todo_write',
      argsRaw: '{"todos":[{"content":"a","status":"completed"},{"content":"b","status":"in_progress"},{"content":"c","status":"pending"},{"content":"d","status":"pending"}]}',
      rawText: '',
    })
    expect(model).toMatchObject({
      kind: 'todo',
      title: 'Tasks · 1 done · 1 in progress · 2 pending',
    })
    expect(model.kind === 'todo' && model.items.length).toBe(4)
    // 字段不齐 → 回退 generic，不炸
    expect(cardModelFromNode({ name: 'todo_write', argsRaw: '{"todos":[{"x":1}]}', rawText: 'raw' }).kind).toBe('generic')
  })
})
