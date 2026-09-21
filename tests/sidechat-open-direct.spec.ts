// @vitest-environment jsdom
/**
 * open.ts 直连腿编排（Workitem_04）：BS ≥ 0.19 ⇒ tab 直连注册在原生右栏，
 * 存活枚举走 live registry（存活面板）+ metaStore（面板卸载但 tab 仍在），
 * 聚焦走 ISidebarRight.focus，meta 走 metaStore。
 * 核心回归面：活伤修复——已有存活 tab 时「新建/提问」必须显式聚焦且草稿
 * 经 pendingDraft 投递（不再被 held 折叠静默丢弃）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import { SIDE_TAB_TYPE } from '../src/client/sidechat/model.ts'
import { clearNativeRuntime, markSideChatOpening, registerLiveSideChat } from '../src/client/sidechat/native.ts'
import { createSideChat, openOrFocusSideChat, reopenSideChat, sideChatTargetTitle } from '../src/client/sidechat/open.ts'
import { readSideChatMeta, writeSideChatMeta } from '../src/client/sidechat/metaStore.ts'

const SESSION = 'sess-1'

interface MockFace {
  openTab: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

/** 直连腿 ctx：BS 0.19 版本信号 + sidebarRight mock 面 + sessions.list。 */
function directCtx(): { ctx: Context, face: MockFace } {
  const face: MockFace = {
    openTab: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
  }
  const ctx = {
    betterSidebar: { version: '0.19.1' },
    sessions: { list: { getSnapshot: () => ({ current: SESSION, byId: {} }), subscribe: () => () => {} } },
    get: (name: string) => (name === 'sidebarRight' ? face : undefined),
  } as unknown as Context
  return { ctx, face }
}

function liveMeta(tabId: string, extra?: { childId?: string, number?: number }): void {
  writeSideChatMeta({
    tabId,
    sessionId: SESSION,
    parentSessionId: SESSION,
    ...(extra?.childId !== undefined ? { childId: extra.childId } : {}),
    number: extra?.number ?? 1,
    createdAt: 1,
  }, { silent: true })
}

beforeEach(() => {
  localStorage.clear()
  clearNativeRuntime()
})

describe('openOrFocusSideChat（直连腿）', () => {
  it('无存活无窗口：openTab 铸造（params 携带 parentSessionId/pendingDraft）并标记窗口', () => {
    const { ctx, face } = directCtx()
    expect(openOrFocusSideChat(ctx, SESSION, '问一下')).toBe(true)
    expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, {
      params: { parentSessionId: SESSION, pendingDraft: '问一下' },
    })
    // 窗口期内重复触发：草稿落 openings 暂存，不再开第二个 tab
    expect(openOrFocusSideChat(ctx, SESSION, '再补一句')).toBe(true)
    expect(face.openTab).toHaveBeenCalledTimes(1)
  })

  it('存活面板：草稿直达 seedDraft + focus，不开新 tab', () => {
    const { ctx, face } = directCtx()
    const seedDraft = vi.fn()
    const dispose = registerLiveSideChat(SESSION, 'tab-1', seedDraft, () => ({}), () => '侧边')
    expect(openOrFocusSideChat(ctx, SESSION, '继续问')).toBe(true)
    expect(seedDraft).toHaveBeenCalledWith('继续问')
    expect(face.focus).toHaveBeenCalledWith('tab-1')
    expect(face.openTab).not.toHaveBeenCalled()
    dispose()
  })

  it('活伤修复：tab 存活但面板已卸载（metaStore 有记录）→ 草稿写 pendingDraft 并 focus，不开新 tab 不丢草稿', () => {
    const { ctx, face } = directCtx()
    liveMeta('tab-old', { childId: 'child-1' })
    expect(openOrFocusSideChat(ctx, SESSION, '这段什么意思')).toBe(true)
    expect(face.openTab).not.toHaveBeenCalled()
    expect(face.focus).toHaveBeenCalledWith('tab-old')
    expect(readSideChatMeta(SESSION, 'tab-old')?.pendingDraft).toBe('这段什么意思')
    // 再投一次：换行追加（appendDraftText 语义）
    expect(openOrFocusSideChat(ctx, SESSION, '追问')).toBe(true)
    expect(readSideChatMeta(SESSION, 'tab-old')?.pendingDraft).toBe('这段什么意思\n追问')
  })

  it('createSideChat 在单实例期折叠为 openOrFocus（聚焦既有 + 草稿投递）', () => {
    const { ctx, face } = directCtx()
    liveMeta('tab-old')
    expect(createSideChat(ctx, SESSION, '带草稿')).toBe(true)
    expect(face.openTab).not.toHaveBeenCalled()
    expect(readSideChatMeta(SESSION, 'tab-old')?.pendingDraft).toBe('带草稿')
  })

  it('会话不在屏：拒绝（不越权开 tab）', () => {
    const { ctx, face } = directCtx()
    expect(openOrFocusSideChat(ctx, 'other-session', 'x')).toBe(false)
    expect(face.openTab).not.toHaveBeenCalled()
  })
})

describe('reopenSideChat（直连腿）', () => {
  it('无存活：openTab 携带 childId 恢复参数 + 标记窗口', () => {
    const { ctx, face } = directCtx()
    expect(reopenSideChat(ctx, SESSION, 'child-9')).toBe(true)
    expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, {
      params: { parentSessionId: SESSION, childId: 'child-9' },
    })
  })

  it('有存活实例：拒绝（held 折叠会丢恢复信息，弹层本就不列）', () => {
    const { ctx, face } = directCtx()
    liveMeta('tab-live')
    expect(reopenSideChat(ctx, SESSION, 'child-9')).toBe(false)
    expect(face.openTab).not.toHaveBeenCalled()
  })
})

describe('sideChatTargetTitle（直连腿）', () => {
  it('无实例时回退基础标题；有存活记录时读 metaStore 编号', () => {
    const { ctx } = directCtx()
    expect(sideChatTargetTitle(ctx, SESSION)).toBe('Side')
    liveMeta('tab-2', { number: 2 })
    expect(sideChatTargetTitle(ctx, SESSION)).toBe('Side 2')
  })
})

describe('openings 窗口', () => {
  it('markSideChatOpening 后 openOrFocus 落暂存不铸造', () => {
    const { ctx, face } = directCtx()
    markSideChatOpening(SESSION)
    expect(openOrFocusSideChat(ctx, SESSION, '草稿')).toBe(true)
    expect(face.openTab).not.toHaveBeenCalled()
  })
})
