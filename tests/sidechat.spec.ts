/**
 * 侧边聊天纯逻辑层单测：Tab 编号标题、meta 解析容错、状态树遍历、
 * fork 准入、面板相位、消息流折叠。全部无副作用，不挂 DOM。
 */
import { describe, expect, it } from 'vitest'
import type { Context, ConversationSnapshot, SidebarState } from '../src/context-types.ts'
import {
  SIDE_TAB_TYPE,
  appendDraftText,
  canForkFrom,
  collectSideTabs,
  collectTabs,
  contentTextOf,
  countSideTabs,
  mintSideTabId,
  nodeToMessage,
  parseSideChatMeta,
  phaseOf,
  sideTabTitle,
  transcriptOf,
  truncateText,
} from '../src/client/sidechat/model.ts'

// ── 标题编号 ────────────────────────────────────────────────────────────────

describe('sideTabTitle', () => {
  it('首个叫「Side」', () => {
    expect(sideTabTitle([])).toBe('Side')
  })
  it('并存时新 Tab 编号「Side N」（N = 既有最大编号 + 1）', () => {
    expect(sideTabTitle(['Side'])).toBe('Side 2')
    expect(sideTabTitle(['Side', 'Side 2'])).toBe('Side 3')
  })
  it('关闭后再开不重名（「Side」关闭后，既有「Side 2」→ 新铸「Side 3」）', () => {
    expect(sideTabTitle(['Side 2'])).toBe('Side 3')
  })
  it('无关标题不参与编号', () => {
    expect(sideTabTitle(['Explorer', '终端 3'])).toBe('Side')
  })
})

describe('mintSideTabId', () => {
  it('铸 side:<uuid> 且互不相同', () => {
    const a = mintSideTabId()
    const b = mintSideTabId()
    expect(a).toMatch(/^side:[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })
})

// ── meta 解析容错 ───────────────────────────────────────────────────────────

describe('parseSideChatMeta', () => {
  it('非对象输入一律解析为空 meta', () => {
    expect(parseSideChatMeta(undefined)).toEqual({})
    expect(parseSideChatMeta(null)).toEqual({})
    expect(parseSideChatMeta('side:1')).toEqual({})
    expect(parseSideChatMeta(42)).toEqual({})
    expect(parseSideChatMeta([])).toEqual({})
  })
  it('字段齐全时原样取出', () => {
    expect(parseSideChatMeta({ childId: 'c1', parentSessionId: 'p1', pendingDraft: '草稿' })).toEqual({
      childId: 'c1',
      parentSessionId: 'p1',
      pendingDraft: '草稿',
    })
  })
  it('类型漂移的字段被丢弃，合法字段保留', () => {
    expect(parseSideChatMeta({ childId: 7, parentSessionId: 'p1', pendingDraft: null })).toEqual({
      parentSessionId: 'p1',
    })
  })
  it('空字符串字段视为缺省', () => {
    expect(parseSideChatMeta({ childId: '', pendingDraft: '' })).toEqual({})
  })
})

// ── 状态树遍历 ──────────────────────────────────────────────────────────────

function leaf(id: string, tabs: unknown[]) {
  return { kind: 'leaf', id, tabs, active: null }
}
function split(id: string, children: unknown[]) {
  return { kind: 'split', id, dir: 'row', sizes: [1, 1], children }
}
function sideTab(id: string, meta?: unknown) {
  return { id, type: SIDE_TAB_TYPE, title: '侧边', ...(meta !== undefined ? { meta } : {}) }
}

describe('collectTabs / collectSideTabs / countSideTabs', () => {
  const state = {
    splits: split('s:1', [
      leaf('p:1', [sideTab('side:a'), { id: 'e:1', type: 'explorer', title: 'Explorer' }]),
      leaf('p:2', []),
    ]),
    bottomSplits: leaf('p:3', [sideTab('side:b'), sideTab('side:c')]),
  }

  it('枚举两棵树的全部 Tab', () => {
    expect(collectTabs(state).map(t => t.id)).toEqual(['side:a', 'e:1', 'side:b', 'side:c'])
  })
  it('侧边 Tab 过滤与计数', () => {
    expect(collectSideTabs(state).map(t => t.id)).toEqual(['side:a', 'side:b', 'side:c'])
    expect(countSideTabs(state)).toBe(3)
  })
  it('meta 随 Tab 一并取出', () => {
    const withMeta = { splits: leaf('p:1', [sideTab('side:x', { childId: 'c1' })]) }
    expect(collectSideTabs(withMeta)[0]?.meta).toEqual({ childId: 'c1' })
  })
  it('布局漂移/畸形输入不抛错', () => {
    expect(collectTabs(undefined)).toEqual([])
    expect(collectTabs(null)).toEqual([])
    expect(collectTabs({})).toEqual([])
    expect(collectTabs({ splits: { kind: 'leaf', tabs: 'boom' } })).toEqual([])
    expect(collectTabs({ splits: { kind: 'leaf', tabs: [{ nope: 1 }, sideTab('side:ok')] } }).map(t => t.id)).toEqual(['side:ok'])
    expect(countSideTabs({ splits: null, bottomSplits: 42 })).toBe(0)
  })
})

// ── fork 准入 ───────────────────────────────────────────────────────────────

function ctxWithList(byId: Record<string, { blank?: boolean } | undefined>): Context {
  return {
    sessions: { list: { getSnapshot: () => ({ byId }), subscribe: () => () => {} } },
  } as unknown as Context
}

describe('canForkFrom', () => {
  it('blank 会话禁用（fork 必败，提前拦截）', () => {
    expect(canForkFrom(ctxWithList({ s1: { blank: true } }), 's1')).toBe(false)
  })
  it('非 blank 会话放行', () => {
    expect(canForkFrom(ctxWithList({ s1: { blank: false } }), 's1')).toBe(true)
  })
  it('摘要缺失/服务抛错时放行（交给面板 fork 错误态兜底）', () => {
    expect(canForkFrom(ctxWithList({}), 'ghost')).toBe(true)
    expect(canForkFrom({} as unknown as Context, 's1')).toBe(true)
  })
})

// ── 面板相位 ────────────────────────────────────────────────────────────────

describe('phaseOf', () => {
  it('无 childId 且无错误 → forking', () => {
    expect(phaseOf({ childId: undefined, forkError: null, bound: false, listPhase: undefined, listed: false })).toBe('forking')
  })
  it('无 childId 且有 fork 错误 → fork-error', () => {
    expect(phaseOf({ childId: undefined, forkError: 'fork-unavailable', bound: false, listPhase: 'ready', listed: false })).toBe('fork-error')
  })
  it('已绑定 → chat（不看列表相位）', () => {
    expect(phaseOf({ childId: 'c1', forkError: null, bound: true, listPhase: 'pending', listed: false })).toBe('chat')
  })
  it('列表就绪且子会话不在列 → missing', () => {
    expect(phaseOf({ childId: 'c1', forkError: null, bound: false, listPhase: 'ready', listed: false })).toBe('missing')
  })
  it('列表未就绪或在列但绑定未立 → loading', () => {
    expect(phaseOf({ childId: 'c1', forkError: null, bound: false, listPhase: 'pending', listed: false })).toBe('loading')
    expect(phaseOf({ childId: 'c1', forkError: null, bound: false, listPhase: 'ready', listed: true })).toBe('loading')
    expect(phaseOf({ childId: 'c1', forkError: null, bound: false, listPhase: undefined, listed: false })).toBe('loading')
  })
})

// ── 草稿拼接 / 文本工具 ─────────────────────────────────────────────────────

describe('appendDraftText', () => {
  it('空草稿直接落文本', () => {
    expect(appendDraftText('', '你好')).toBe('你好')
    expect(appendDraftText('   ', '你好')).toBe('你好')
  })
  it('已有草稿换行追加', () => {
    expect(appendDraftText('已有', '追加')).toBe('已有\n追加')
  })
})

describe('truncateText', () => {
  it('未超限原样返回', () => {
    expect(truncateText('abc', 3)).toBe('abc')
  })
  it('超限截断并加省略号', () => {
    expect(truncateText('abcd', 3)).toBe('abc…')
  })
})

describe('contentTextOf', () => {
  it('text 块拼接、image 块占位、未知块忽略', () => {
    expect(contentTextOf([
      { type: 'text', text: '一' },
      { type: 'image' },
      { type: 'tool_use', id: 'x' },
      { type: 'text', text: '二' },
    ])).toBe('一\n[图片]\n二')
  })
  it('非数组/空输入返回空串', () => {
    expect(contentTextOf(undefined)).toBe('')
    expect(contentTextOf('text')).toBe('')
    expect(contentTextOf([])).toBe('')
  })
})

// ── 消息流折叠 ──────────────────────────────────────────────────────────────

describe('nodeToMessage', () => {
  it('user 节点 → user 行', () => {
    expect(nodeToMessage({ kind: 'user', seq: 1, content: [{ type: 'text', text: '问题' }] })).toEqual({
      key: 'u:1', role: 'user', text: '问题',
    })
  })
  it('steering 节点 → user 行', () => {
    expect(nodeToMessage({ kind: 'steering', seq: 2, content: [{ type: 'text', text: '插队' }] })?.role).toBe('user')
  })
  it('assistant 节点：文本 + 思考 + 打断标记', () => {
    expect(nodeToMessage({
      kind: 'assistant',
      seq: 3,
      interrupted: true,
      blocks: [
        { kind: 'reasoning', text: '想想' },
        { kind: 'text', text: '回答' },
      ],
    })).toEqual({ key: 'a:3', role: 'assistant', text: '回答', reasoning: '想想', interrupted: true })
  })
  it('assistant 节点：纯工具调用头不渲染（结果节点承载卡片）', () => {
    expect(nodeToMessage({ kind: 'assistant', seq: 4, blocks: [{ kind: 'tool-call', callId: 'c', name: 'Bash', argsRaw: '{}' }] })).toBeNull()
  })
  it('tool-result 节点 → 工具卡片（带名/失败标记/正文截断）', () => {
    const long = 'x'.repeat(5000)
    const message = nodeToMessage({
      kind: 'tool-result',
      seq: 5,
      callId: 'c1',
      call: { name: 'Bash' },
      isError: true,
      content: [{ type: 'text', text: long }],
    })
    expect(message?.role).toBe('tool')
    expect(message?.toolName).toBe('Bash')
    expect(message?.isError).toBe(true)
    expect(message?.text.length).toBe(4001) // 4000 + …
  })
  it('tool-result 缺 call 头时回退 callId', () => {
    expect(nodeToMessage({ kind: 'tool-result', seq: 6, callId: 'c9', call: null, content: [] })?.toolName).toBe('c9')
  })
  it('turn-error → error 行', () => {
    expect(nodeToMessage({ kind: 'turn-error', seq: 7, message: '炸了' })).toEqual({ key: 'e:7', role: 'error', text: '炸了' })
  })
  it('model-retry：已取消不渲染，其余为提示行', () => {
    expect(nodeToMessage({ kind: 'model-retry', seq: 8, retryState: 'cancelled' })).toBeNull()
    expect(nodeToMessage({ kind: 'model-retry', seq: 8, retryState: 'scheduled' })?.role).toBe('notice')
    expect(nodeToMessage({ kind: 'model-retry', seq: 8, retryState: 'started' })?.text).toContain('重试')
  })
  it('turn-max-tokens / command / compaction → notice 行', () => {
    expect(nodeToMessage({ kind: 'turn-max-tokens', seq: 9 })?.role).toBe('notice')
    expect(nodeToMessage({ kind: 'command', seq: 10, name: 'goal', args: ' x' })?.text).toBe('执行命令 /goal x')
    expect(nodeToMessage({ kind: 'compaction', seq: 11 })?.text).toContain('压缩')
  })
  it('context / unknown / 畸形节点不渲染', () => {
    expect(nodeToMessage({ kind: 'context', seq: 12 })).toBeNull()
    expect(nodeToMessage({ kind: 'unknown', seq: 13 })).toBeNull()
    expect(nodeToMessage(undefined)).toBeNull()
    expect(nodeToMessage('boom')).toBeNull()
  })
})

describe('transcriptOf', () => {
  it('空快照/未绑定 → 空列表', () => {
    expect(transcriptOf(undefined)).toEqual([])
    expect(transcriptOf(null)).toEqual([])
    expect(transcriptOf({} as unknown as ConversationSnapshot)).toEqual([])
  })
  it('节点 + 在途工具 + 流式部分依序折叠', () => {
    const snapshot = {
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: '问' }] },
        { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '答' }] },
      ],
      runningCalls: [{ callId: 'c1', name: 'Bash' }],
      partial: { blocks: [{ kind: 'text', text: '正在' }] },
    } as unknown as ConversationSnapshot
    expect(transcriptOf(snapshot)).toEqual([
      { key: 'u:1', role: 'user', text: '问' },
      { key: 'a:2', role: 'assistant', text: '答' },
      { key: 'rc:c1', role: 'tool', toolName: 'Bash', text: '', streaming: true },
      { key: 'partial', role: 'assistant', text: '正在', streaming: true },
    ])
  })
  it('partial 只有工具调用头时不渲染空泡', () => {
    const snapshot = {
      nodes: [],
      partial: { blocks: [{ kind: 'tool-call', callId: 'c', name: 'Read', argsRaw: '' }] },
    } as unknown as ConversationSnapshot
    expect(transcriptOf(snapshot)).toEqual([])
  })
  it('空 partial 渲染流式占位（正在输出）', () => {
    const snapshot = { nodes: [], partial: { blocks: [] } } as unknown as ConversationSnapshot
    expect(transcriptOf(snapshot)).toEqual([{ key: 'partial', role: 'assistant', text: '', streaming: true }])
  })
})

// ── 布局形状冒烟（类型层守护：镜像合并后的 SidebarState 必须带树） ──────────

describe('SidebarState 镜像', () => {
  it('镜像类型携带 splits/bottomSplits 树', () => {
    const state: SidebarState = {
      splits: { kind: 'leaf', id: 'p:1', tabs: [], active: null },
      bottomSplits: { kind: 'leaf', id: 'p:2', tabs: [], active: null },
    }
    expect(countSideTabs(state)).toBe(0)
  })
})
