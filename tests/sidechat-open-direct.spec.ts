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

/** 直连腿 ctx：sidebarRight mock 面 + sessions.list；withBs=true 时 BS 0.19.1
 *  在场（真实主路径——属性与 get 双通道可达），否则 BS 缺席（optional peer）。 */
function directCtx(opts?: { withBs?: boolean }): { ctx: Context, face: MockFace } {
  const face: MockFace = {
    openTab: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
  }
  const bs = { version: '0.19.1' }
  const withBs = opts?.withBs === true
  const ctx = {
    ...(withBs ? { betterSidebar: bs } : {}),
    sessions: { list: { getSnapshot: () => ({ current: SESSION, byId: {} }), subscribe: () => () => {} } },
    get: (name: string) => {
      if (name === 'sidebarRight') return face
      if (name === 'betterSidebar') return withBs ? bs : undefined
      return undefined
    },
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

  it('活伤修复：metaStore 有记录 → 草稿写 pendingDraft + openTab（held 折叠聚焦由宿主裁定）', () => {
    const { ctx, face } = directCtx()
    liveMeta('tab-old', { childId: 'child-1' })
    expect(openOrFocusSideChat(ctx, SESSION, '这段什么意思')).toBe(true)
    // openTab 即裁定（审查 M-3）：tab 在 → held 聚焦；不在（孤键）→ 新铸自愈。
    // 有存活记录时 params 不带 pendingDraft（草稿走 metaStore——存活面板的
    // 唯一可达通道，reconcile 幂等不消费 params）。
    expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, {
      params: { parentSessionId: SESSION },
    })
    expect(readSideChatMeta(SESSION, 'tab-old')?.pendingDraft).toBe('这段什么意思')
    // 再投一次：清掉 openings 窗口标记（第一次 openTab 后标的），
    // 让第二投仍走 metaStore 追加（appendDraftText 语义）。
    clearNativeRuntime()
    expect(openOrFocusSideChat(ctx, SESSION, '追问')).toBe(true)
    expect(readSideChatMeta(SESSION, 'tab-old')?.pendingDraft).toBe('这段什么意思\n追问')
  })

  it('createSideChat 在单实例期折叠为 openOrFocus（openTab 聚焦既有 + 草稿投递）', () => {
    const { ctx, face } = directCtx()
    liveMeta('tab-old')
    expect(createSideChat(ctx, SESSION, '带草稿')).toBe(true)
    expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, { params: { parentSessionId: SESSION } })
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

describe('BS ≥ 0.19 在场的真实主路径（审查 n1：旧 mock 全部从 BS 缺席分支进入）', () => {
  it('openOrFocus 与 reopen 与 BS 缺席分支行为一致（直连编排不依赖 BS）', () => {
    const { ctx, face } = directCtx({ withBs: true })
    expect(openOrFocusSideChat(ctx, SESSION, '问一下')).toBe(true)
    expect(face.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, {
      params: { parentSessionId: SESSION, pendingDraft: '问一下' },
    })
    const { ctx: ctx2, face: face2 } = directCtx({ withBs: true })
    expect(reopenSideChat(ctx2, SESSION, 'child-9')).toBe(true)
    expect(face2.openTab).toHaveBeenCalledWith(SIDE_TAB_TYPE, {
      params: { parentSessionId: SESSION, childId: 'child-9' },
    })
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
