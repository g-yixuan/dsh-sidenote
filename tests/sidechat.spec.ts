/**
 * 侧边聊天纯逻辑层单测：Tab 编号标题、meta 解析容错、状态树遍历、
 * fork 准入、面板相位、消息流折叠。全部无副作用，不挂 DOM。
 */
import { describe, expect, it } from 'vitest'
import type { Context, ConversationSnapshot, SidebarState } from '../src/client/host/contracts.ts'
import {
  SIDE_TAB_TYPE,
  appendDraftText,
  canForkFrom,
  collectSideTabs,
  collectTabs,
  mintSideTabId,
  parseSideChatMeta,
  phaseOf,
  sideTabTitle,
} from '../src/client/sidechat/model.ts'
import { createSideChat, openOrFocusSideChat, sideChatTargetTitle } from '../src/client/sidechat/open.ts'

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

describe('collectTabs / collectSideTabs', () => {
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
    expect(collectSideTabs(state)).toHaveLength(3)
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
    expect(collectSideTabs({ splits: null, bottomSplits: 42 })).toHaveLength(0)
  })
  it('0.16 浮动窗 floats 里的 Tab 一并枚举（缺失字段时跳过）', () => {
    const withFloats = {
      splits: leaf('p:1', [sideTab('side:a')]),
      floats: [
        { id: 'f:1', tab: sideTab('side:float') },
        { id: 'f:2' }, // 畸形：无 tab 字段
        { id: 'f:3', tab: { nope: 1 } }, // 畸形：tab 不像 Tab
      ],
    }
    expect(collectTabs(withFloats).map(t => t.id)).toEqual(['side:a', 'side:float'])
    expect(collectSideTabs(withFloats).map(t => t.id)).toEqual(['side:a', 'side:float'])
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

// ── 草稿拼接 ─────────────────────────────────────────────────────

describe('appendDraftText', () => {
  it('空草稿直接落文本', () => {
    expect(appendDraftText('', '你好')).toBe('你好')
    expect(appendDraftText('   ', '你好')).toBe('你好')
  })
  it('已有草稿换行追加', () => {
    expect(appendDraftText('已有', '追加')).toBe('已有\n追加')
  })
})

// ── 布局形状冒烟（类型层守护：镜像合并后的 SidebarState 必须带树） ──────────

describe('SidebarState 镜像', () => {
  it('镜像类型携带 splits/bottomSplits 树', () => {
    const state: SidebarState = {
      splits: { kind: 'leaf', id: 'p:1', tabs: [], active: null },
      bottomSplits: { kind: 'leaf', id: 'p:2', tabs: [], active: null },
    }
    expect(collectSideTabs(state)).toHaveLength(0)
  })
})

// ── 打开编排（open.ts）：新建/聚焦语义与目标预览 ─────────────────────────────

/** 最小 fake：openTab 同步铸造新 Tab 落状态（模拟宿主行为）。 */
function fakeSidebarCtx(initialTabs: Array<{ id: string; title: string }>) {
  let tabs = initialTabs.map(t => ({ ...t, type: SIDE_TAB_TYPE }))
  const updates: Array<{ id: string; patch: unknown }> = []
  const activations: string[] = []
  let minted = 0
  const ctx = {
    betterSidebar: {
      // 显式 legacy 宿主（nativeSidebarHost=false），锁定 pre-0.19 路径。
      version: '0.18.0',
      getSnapshot: () => ({ sessionId: 'sess', state: { splits: leaf('p:1', tabs) } }),
      isTabEnabled: () => true,
      openTab: () => {
        minted += 1
        tabs = [...tabs, { id: `side:minted-${minted}`, type: SIDE_TAB_TYPE, title: sideTabTitle(tabs.map(t => t.title)) }]
      },
      updateTab: (id: string, patch: unknown) => { updates.push({ id, patch }) },
      activateTab: (id: string) => { activations.push(id) },
    },
  } as unknown as Context
  return { ctx, updates, activations, tabCount: () => tabs.length, tabs: () => tabs }
}

describe('openOrFocusSideChat / createSideChat / sideChatTargetTitle', () => {
  it('已有侧边聊天时 openOrFocus 聚焦最后一个（不新建）', () => {
    const fake = fakeSidebarCtx([{ id: 'side:a', title: 'Side' }])
    expect(openOrFocusSideChat(fake.ctx, 'sess')).toBe(true)
    expect(fake.activations).toEqual(['side:a'])
    expect(fake.tabCount()).toBe(1)
  })
  it('createSideChat 无条件新建（/side「新建」选项语义）', () => {
    const fake = fakeSidebarCtx([{ id: 'side:a', title: 'Side' }])
    expect(createSideChat(fake.ctx, 'sess')).toBe(true)
    expect(fake.tabCount()).toBe(2)
    expect(fake.tabs()[1]?.title).toBe('Side 2')
  })
  it('目标预览：有并存报最后一个标题，无并存报首个标题', () => {
    const fake = fakeSidebarCtx([{ id: 'side:a', title: 'Side' }, { id: 'side:b', title: 'Side 2' }])
    expect(sideChatTargetTitle(fake.ctx, 'sess')).toBe('Side 2')
    expect(sideChatTargetTitle(fakeSidebarCtx([]).ctx, 'sess')).toBe('Side')
  })
  it('新建携带 draftText 时写入新 Tab 的 pendingDraft', () => {
    const fake = fakeSidebarCtx([])
    expect(createSideChat(fake.ctx, 'sess', '> 引用\nNote: 注')).toBe(true)
    expect(fake.updates).toHaveLength(1)
    expect((fake.updates[0]?.patch as { meta?: { pendingDraft?: string } }).meta?.pendingDraft).toBe('> 引用\nNote: 注')
  })
})
