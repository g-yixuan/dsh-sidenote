/**
 * native.ts + the model-sync helpers in lifecycle.ts: the better-sidebar 0.19
 * bridge. Pure logic only — no DOM, no host.
 */
import { describe, expect, it, vi } from 'vitest'
import { clearNativeRuntime, lastLiveSideChat, liveSideChat, liveSideChatsOf, markSideChatOpening, nativeSidebarHost, nativeTabShell, registerLiveSideChat, rootContext, setRootContext, sideChatOpening } from '../src/client/sidechat/native.ts'
import { projectedModelSelection, readModelSelection, remoteSessionFace, writeModelSelection } from '../src/client/sidechat/lifecycle.ts'
import { createSideChat, openOrFocusSideChat, reopenSideChat, sideChatTargetTitle } from '../src/client/sidechat/open.ts'
import { registerSideCommand } from '../src/client/sidechat/slash.ts'
import { SIDE_TAB_TYPE } from '../src/client/sidechat/model.ts'
import type { Context } from '../src/client/host/contracts.ts'

function ctxWithVersion(version: string): Context {
  return { betterSidebar: { version } } as unknown as Context
}

describe('nativeSidebarHost', () => {
  it('>= 0.19 is native; older/unparsable keeps legacy behaviour', () => {
    expect(nativeSidebarHost(ctxWithVersion('0.19.0'))).toBe(true)
    expect(nativeSidebarHost(ctxWithVersion('0.20.1'))).toBe(true)
    expect(nativeSidebarHost(ctxWithVersion('1.0.0'))).toBe(true)
    expect(nativeSidebarHost(ctxWithVersion('0.18.9'))).toBe(false)
    expect(nativeSidebarHost(ctxWithVersion('nope'))).toBe(false)
    expect(nativeSidebarHost({} as Context)).toBe(false)
  })
})

describe('rootContext', () => {
  it('falls back until setRootContext, then prefers the root', () => {
    const fallback = { tag: 'slot' } as unknown as Context
    const root = { tag: 'root' } as unknown as Context
    setRootContext(root)
    expect(rootContext(fallback)).toBe(root)
  })
})

describe('live side-chat registry', () => {
  it('registers, reads back meta, finds the last panel of a session, disposes', () => {
    const meta = { childId: 'child-1' }
    const dispose = registerLiveSideChat('sess-1', 'tab-1', () => {}, () => meta, () => '侧边')
    expect(liveSideChat('tab-1')).toMatchObject({ tabId: 'tab-1', sessionId: 'sess-1' })
    expect(nativeTabShell('tab-1', 'sidechat')).toMatchObject({ id: 'tab-1', type: 'sidechat', meta })
    expect(lastLiveSideChat('sess-1')?.tabId).toBe('tab-1')
    dispose()
    expect(liveSideChat('tab-1')).toBeUndefined()
    expect(nativeTabShell('tab-1', 'sidechat')).toBeUndefined()
  })
})

describe('projectedModelSelection / remoteSessionFace', () => {
  const selection = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }

  it('reads the modelSelection projection snapshot', () => {
    const ctx = {
      sessions: {
        binding: () => ({
          session: { projections: { faceOf: (name: string) => name === 'modelSelection' ? { getSnapshot: () => ({ next: selection }) } : undefined } },
        }),
      },
    } as unknown as Context
    expect(projectedModelSelection(ctx, 'sess-1')).toEqual(selection)
  })

  it('returns undefined when the projection is absent or throws', () => {
    expect(projectedModelSelection({ sessions: { binding: () => undefined } } as unknown as Context, 'sess-1')).toBeUndefined()
    const throwing = { sessions: { binding: () => { throw new Error('no face') } } } as unknown as Context
    expect(projectedModelSelection(throwing, 'sess-1')).toBeUndefined()
  })

  it('remoteSessionFace：get("remote.session") 优先，get("remote") 容器下钻 .session', () => {
    const face = { selectModel: vi.fn() }
    const viaGet = { get: (name: string) => name === 'remote.session' ? face : undefined } as unknown as Context
    expect(remoteSessionFace(viaGet)).toBe(face)
    // 'remote' 命名空间容器形态：下钻 .session 成员
    const viaContainer = { get: (name: string) => name === 'remote' ? { session: face } : undefined } as unknown as Context
    expect(remoteSessionFace(viaContainer)).toBe(face)
    // 容器形态但 session 上没有 selectModel → 不匹配
    const wrongContainer = { get: (name: string) => name === 'remote' ? { session: {} } : undefined } as unknown as Context
    expect(remoteSessionFace(wrongContainer)).toBeUndefined()
    expect(remoteSessionFace({ get: () => undefined } as unknown as Context)).toBeUndefined()
  })

  it('projectedModelSelection：next 为 null 时回落 lastUsed；双 null 回 undefined', () => {
    const withLastUsed = {
      sessions: {
        binding: () => ({
          session: { projections: { faceOf: () => ({ getSnapshot: () => ({ next: null, lastUsed: selection }) }) } },
        }),
      },
    } as unknown as Context
    expect(projectedModelSelection(withLastUsed, 'sess-1')).toEqual(selection)
    const bothNull = {
      sessions: {
        binding: () => ({
          session: { projections: { faceOf: () => ({ getSnapshot: () => ({ next: null, lastUsed: null }) }) } },
        }),
      },
    } as unknown as Context
    expect(projectedModelSelection(bothNull, 'sess-1')).toBeUndefined()
  })
})

// ── open.ts 编排层（native 分支）：聚焦面、in-flight 窗口、诚实返回 ──────────
// fake 宿主：native（>= 0.19）宿主上 openTab 不落布局快照，模拟 surface 行为。
function fakeNativeCtx(sessionId: string, opts?: { focus?: (id: string) => void; disabled?: boolean; legacy?: boolean }) {
  const calls = {
    openSeeds: [] as Array<{ type: string; meta?: unknown; title?: string }>,
    updates: [] as Array<{ id: string; patch: unknown }>,
    activations: [] as string[],
    focuses: [] as string[],
  }
  const ctx = {
    betterSidebar: {
      version: opts?.legacy === true ? '0.18.0' : '0.19.1',
      // native 宿主的布局快照永远看不到右栏 tab（空 leaf）。
      getSnapshot: () => ({ sessionId, state: { splits: { kind: 'leaf', tabs: [] } } }),
      isTabEnabled: () => opts?.disabled !== true,
      openTab: (seed: { type: string; meta?: unknown; title?: string }) => { calls.openSeeds.push(seed) },
      updateTab: (id: string, patch: unknown) => { calls.updates.push({ id, patch }) },
      activateTab: (id: string) => { calls.activations.push(id) },
    },
    get: (name: string) => {
      if (name !== 'sidebarRight') return undefined
      const focusFn = opts?.focus
      return focusFn === undefined
        ? undefined
        : { focus: (id: string) => { calls.focuses.push(id); focusFn(id) } }
    },
  } as unknown as Context
  return { ctx, calls }
}

describe('open.ts native 编排', () => {
  it('live 分支：草稿直达面板，聚焦走 sidebarRight.focus（不碰空操作的 activateTab）', () => {
    const { ctx, calls } = fakeNativeCtx('s-live', { focus: () => {} })
    const seedDraft = vi.fn()
    const dispose = registerLiveSideChat('s-live', 'tab-live', seedDraft, () => ({}), () => '侧边')
    expect(openOrFocusSideChat(ctx, 's-live', '引文')).toBe(true)
    expect(seedDraft).toHaveBeenCalledWith('引文')
    expect(calls.focuses).toEqual(['tab-live'])
    expect(calls.activations).toEqual([])
    dispose()
  })

  it('live 分支：sidebarRight.focus 缺席时回退 activateTab', () => {
    const { ctx, calls } = fakeNativeCtx('s-live-fb')
    const dispose = registerLiveSideChat('s-live-fb', 'tab-fb', () => {}, () => ({}), () => '侧边')
    expect(openOrFocusSideChat(ctx, 's-live-fb')).toBe(true)
    expect(calls.activations).toEqual(['tab-fb'])
    dispose()
  })

  it('in-flight 窗口：第二次触发不重复开 tab，草稿暂存并在面板注册时回放', () => {
    const { ctx, calls } = fakeNativeCtx('s-race')
    expect(createSideChat(ctx, 's-race', '首发草稿')).toBe(true)
    expect(calls.openSeeds).toHaveLength(1)
    expect((calls.openSeeds[0] as { meta?: { pendingDraft?: string } }).meta?.pendingDraft).toBe('首发草稿')
    // 窗口内第二次触发：不再 openTab，草稿进标记
    expect(openOrFocusSideChat(ctx, 's-race', '后续草稿')).toBe(true)
    expect(calls.openSeeds).toHaveLength(1)
    // 面板注册 → 回放
    const seedDraft = vi.fn()
    const dispose = registerLiveSideChat('s-race', 'tab-race', seedDraft, () => ({}), () => '侧边')
    expect(seedDraft).toHaveBeenCalledWith('后续草稿')
    dispose()
  })

  it('createSideChat：类型被设置禁用时诚实返回 false（不开 tab）', () => {
    const { ctx, calls } = fakeNativeCtx('s-off', { disabled: true })
    expect(createSideChat(ctx, 's-off')).toBe(false)
    expect(calls.openSeeds).toHaveLength(0)
  })

  it('createSideChat：legacy 宿主找不到 created 时返回 false', () => {
    const { ctx } = fakeNativeCtx('s-leg', { legacy: true })
    expect(createSideChat(ctx, 's-leg')).toBe(false)
  })

  it('reopenSideChat：native 下 seed.meta 携带 childId/parentSessionId 并乐观返回', () => {
    const { ctx, calls } = fakeNativeCtx('s-reopen')
    expect(reopenSideChat(ctx, 's-reopen', 'child-9', '侧边 2')).toBe(true)
    expect(calls.openSeeds).toHaveLength(1)
    expect(calls.openSeeds[0]).toMatchObject({
      type: SIDE_TAB_TYPE,
      title: '侧边 2',
      meta: { childId: 'child-9', parentSessionId: 's-reopen' },
    })
  })

  it('reopenSideChat：legacy 找不到 created 时返回 false（不谎报）', () => {
    const { ctx } = fakeNativeCtx('s-reopen-leg', { legacy: true })
    expect(reopenSideChat(ctx, 's-reopen-leg', 'child-9')).toBe(false)
  })
})

// ── 模型读写双版本链（lifecycle.ts）──────────────────────────────────────────
describe('readModelSelection / writeModelSelection（双版本链）', () => {
  const selection = { provider: 'p', model: 'm', reasoningEffort: 'high' }
  const projectionCtx = {
    sessions: {
      binding: () => ({
        session: { projections: { faceOf: () => ({ getSnapshot: () => ({ next: selection }) }) } },
      }),
    },
  } as unknown as Context
  const legacyModels = vi.fn(async () => ({ result: { ok: true as const, value: { current: { provider: 'old-p', model: 'old-m' } } } }))
  const legacySelect = vi.fn(async () => ({ result: { ok: true as const, value: { selected: selection } } }))
  const legacyCtx = {
    sessions: { binding: () => undefined },
    connection: { api: { sessions: { models: legacyModels, selectModel: legacySelect } } },
    get: () => undefined,
  } as unknown as Context

  it('读：投影命中时不调旧 RPC；投影缺席回退旧面；双缺席 undefined', async () => {
    const spyCtx = { ...legacyCtx, sessions: (projectionCtx as { sessions: unknown }).sessions } as unknown as Context
    expect(await readModelSelection(spyCtx, 's')).toEqual(selection)
    expect(legacyModels).not.toHaveBeenCalled()
    expect(await readModelSelection(legacyCtx, 's')).toEqual({ provider: 'old-p', model: 'old-m' })
    const empty = { sessions: { binding: () => undefined }, get: () => undefined } as unknown as Context
    // 无投影且无 connection：属性访问抛错被吞 → undefined
    expect(await readModelSelection(empty, 's')).toBeUndefined()
  })

  it('写：remote 面命中；remote 真实失败不落旧面；remote 缺席回退旧面', async () => {
    const okFace = { selectModel: vi.fn(async () => ({ ok: true as const, value: {} })) }
    const viaRemote = { get: (name: string) => name === 'remote.session' ? okFace : undefined } as unknown as Context
    expect(await writeModelSelection(viaRemote, 's', selection)).toBe(true)
    expect(okFace.selectModel).toHaveBeenCalledWith({ sessionId: 's', provider: 'p', model: 'm', reasoningEffort: 'high' })

    // remote 面返回 ok:false（真实失败）→ false，且不回退旧面重试
    legacySelect.mockClear()
    const failFace = { selectModel: vi.fn(async () => ({ ok: false as const, error: { code: 'X' } })) }
    const remoteFail = {
      get: (name: string) => name === 'remote.session' ? failFace : undefined,
      connection: { api: { sessions: { selectModel: legacySelect } } },
    } as unknown as Context
    expect(await writeModelSelection(remoteFail, 's', selection)).toBe(false)
    expect(legacySelect).not.toHaveBeenCalled()

    // remote 缺席 → 旧面
    expect(await writeModelSelection(legacyCtx, 's', selection)).toBe(true)
    const empty = { get: () => undefined } as unknown as Context
    expect(await writeModelSelection(empty, 's', selection)).toBe(false)
  })
})

// ── registry 语义收尾（P2）：打开序、枚举、插件级清场 ─────────────────────────

describe('registry 打开序与清场', () => {
  it('lastLiveSideChat 锚在首次打开序：面板重挂不翻序', () => {
    const disposeA1 = registerLiveSideChat('s-ord', 'tab-A', () => {}, () => ({}), () => '侧边')
    registerLiveSideChat('s-ord', 'tab-B', () => {}, () => ({}), () => '侧边 2')
    // A 重挂载（ dispose + 重注册）
    disposeA1()
    registerLiveSideChat('s-ord', 'tab-A', () => {}, () => ({}), () => '侧边')
    // Map 插入序 A 已挪尾，但打开序不变：最后打开仍是 B
    expect(lastLiveSideChat('s-ord')?.tabId).toBe('tab-B')
    expect(liveSideChatsOf('s-ord').map(e => e.tabId)).toEqual(['tab-A', 'tab-B'])
  })

  it('clearNativeRuntime 清场：registry 与 root 同时失效', () => {
    registerLiveSideChat('s-clr', 'tab-clr', () => {}, () => ({}), () => '侧边')
    markSideChatOpening('s-clr')
    setRootContext({ tag: 'root' } as unknown as Context)
    clearNativeRuntime()
    expect(liveSideChatsOf('s-clr')).toEqual([])
    expect(sideChatOpening('s-clr')).toBeUndefined()
    const fallback = { tag: 'slot' } as unknown as Context
    expect(rootContext(fallback)).toBe(fallback)
  })
})

describe('native 数据源切换（P2）', () => {
  it('sideChatTargetTitle：native 下读 live registry 的标题', () => {
    const { ctx } = fakeNativeCtx('s-ttl')
    const dispose = registerLiveSideChat('s-ttl', 'tab-ttl', () => {}, () => ({}), () => '侧边 3')
    expect(sideChatTargetTitle(ctx, 's-ttl')).toBe('侧边 3')
    dispose()
  })

  it('/side 弹层：native 下聚焦项来自 registry 且聚焦走 sidebarRight.focus', async () => {
    const focusFn = vi.fn()
    const { ctx, calls } = fakeNativeCtx('s-slash', { focus: focusFn })
    // canForkFrom 需要 sessions.list；commandUi 捕获注册的贡献
    ;(ctx as { sessions: unknown }).sessions = {
      list: { getSnapshot: () => ({ byId: { 's-slash': { blank: false } } }) },
    }
    // registerSideCommand 经 ctx.effect 注册——fake 直接立即执行。
    ;(ctx as { effect: unknown }).effect = (fn: () => void) => fn()
    let contribution: { ui: { options: (s: { sessionId: string }) => Promise<readonly { id: string; label: string }[]>; onSelect: (o: { id: string }, s: { sessionId: string }) => void } } | undefined
    ;(ctx as { get: unknown }).get = (name: string) => {
      if (name === 'commandUi') return { register: (c: typeof contribution) => { contribution = c } }
      if (name === 'sidebarRight') return { focus: focusFn }
      return undefined
    }
    const dispose = registerLiveSideChat('s-slash', 'tab-slash', () => {}, () => ({}), () => '侧边 2')
    registerSideCommand(ctx)
    const options = await contribution!.ui.options({ sessionId: 's-slash' })
    expect(options.map(o => o.id)).toContain('focus:tab-slash')
    expect(options.find(o => o.id === 'focus:tab-slash')?.label).toContain('侧边 2')
    contribution!.ui.onSelect({ id: 'focus:tab-slash' }, { sessionId: 's-slash' })
    expect(focusFn).toHaveBeenCalledWith('tab-slash')
    expect(calls.activations).toEqual([])
    // 有存活实例时「新建」被 held 折叠名不副实——不列（dsh sidebar-right：
    // page kind 的 contentId 恒为 sidebar://<kind>，每 pane 单实例）
    const optionsWithLive = await contribution!.ui.options({ sessionId: 's-slash' })
    expect(optionsWithLive.map(o => o.id)).not.toContain('new')
    dispose()
    // 无存活实例后「新建」回归
    const optionsAfterClose = await contribution!.ui.options({ sessionId: 's-slash' })
    expect(optionsAfterClose.map(o => o.id)).toContain('new')
  })

  it('reopenSideChat：native 下有存活实例时拒绝（held 折叠双保险）', () => {
    const { ctx, calls } = fakeNativeCtx('s-guard')
    const dispose = registerLiveSideChat('s-guard', 'tab-live-x', () => {}, () => ({}), () => '侧边')
    expect(reopenSideChat(ctx, 's-guard', 'child-x')).toBe(false)
    expect(calls.openSeeds).toHaveLength(0)
    dispose()
    expect(reopenSideChat(ctx, 's-guard', 'child-x')).toBe(true)
  })
})
