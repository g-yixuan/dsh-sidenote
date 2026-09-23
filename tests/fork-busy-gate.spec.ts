/**
 * busy-fork 编排与遗传 turn 监护（Delivery_04）单测。
 *
 * 守护的事故形态（2026-09-22 真机实证）：主线 turn 在飞时 fork，宿主把在飞
 * 消息以未认领 inbox splice 遗传给子会话——子会话 boot 后替主线执行该任务，
 * 用户真正的侧边消息排进不可见队列。修法：立即 fork（子会话休眠）+ 监护订阅
 * 在 meta 登记（触发开窗 boot）之前就位 + 遗传 turn 开跑即 cancel（文本判别
 * 防误伤用户自己的首个 turn）。
 */
import { describe, expect, it, vi } from 'vitest'
import { armInheritedTurnPurge, forkAndRegister, isPurgingInheritedTurn, sessionBusyOf } from '../src/client/sidechat/lifecycle.ts'
import type { Context } from '../src/client/host/contracts.ts'

interface Env {
  ctx: Context
  fork: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  updateTab: ReturnType<typeof vi.fn>
  childUpdateQueue: ReturnType<typeof vi.fn>
  childPrompt: ReturnType<typeof vi.fn>
  /** 子会话队列现状（剔除路径的观测口）。 */
  childQueue: () => readonly { id: string }[]
  /** 翻转子会话 running 并通知订阅者（模拟遗传 turn 开跑）。 */
  flipChildRunning: () => void
  /** 设置子会话投影的最后一条用户消息文本（文本判别的输入）。 */
  setChildUserText: (text: string) => void
  /** 登记进 meta 的最新值（legacy 腿经 betterSidebar.updateTab）。 */
  lastMeta: () => Record<string, unknown> | undefined
}

/** 每个测试用唯一 childId——purgingChildren 是模块级状态，不复用防串测。 */
let childSeq = 0

function makeEnv(opts: {
  parentRunning: boolean
  forkFails?: 'unavailable' | 'other'
  /** 父会话投影的在飞用户消息（监护判别的前缀来源）。 */
  parentInflightText?: string
  /** 父会话投影的完整节点（覆盖 parentInflightText 的单节点默认形态——
   *  用于 busy 边界语义：已完成轮节点 + 在飞 user 节点共存）。 */
  parentNodes?: unknown[]
  /** 子会话投影里既有的继承节点（freshUserText 须跳过 seq ≤ 边界的它们）。 */
  childInheritedNodes?: unknown[]
  /** 子会话队列里既有的 pending 项（模拟遗传的泄漏消息；QueuedMessage 形态）。 */
  childQueue?: Array<{ id: string; text: string }>
}): Env {
  childSeq += 1
  const childId = `child-${childSeq}`
  const createdId = `${childId}-created`
  const parent = { running: opts.parentRunning }
  const childState = { running: false, userText: '', queue: [...(opts.childQueue ?? [])] }
  const childListeners = new Set<() => void>()
  const cancel = vi.fn(async () => {
    // cancel 落定 = turn 中止：running 回落（和解等的正是这个信号）。
    childState.running = false
    return { ok: true }
  })
  const fork = opts.forkFails === undefined
    ? vi.fn(async () => childId)
    : vi.fn(async () => {
        throw new Error(opts.forkFails === 'unavailable'
          ? `session/fork-unavailable: session "parent-1" has no completed turn to fork from`
          : 'session/not-found: boom')
      })
  const create = vi.fn(async () => createdId)
  let lastMeta: Record<string, unknown> | undefined
  const updateTab = vi.fn((_id: string, patch: { meta: unknown }) => { lastMeta = patch.meta as Record<string, unknown> })
  const parentNodes = opts.parentNodes ?? (opts.parentInflightText === undefined
    ? []
    : [{ kind: 'user', seq: 1, content: [{ type: 'text', text: opts.parentInflightText }] }])
  const parentSession = {
    getSnapshot: () => ({ running: parent.running, pending: [], nodes: parentNodes }),
    subscribe: () => () => {},
  }
  const childSession = {
    getSnapshot: () => ({
      running: childState.running,
      queue: [...childState.queue],
      nodes: [
        ...(opts.childInheritedNodes ?? []),
        // fork 后新增的 user 节点：seq 恒大于继承区（freshUserText 的判别输入）。
        ...(childState.userText === ''
          ? []
          : [{ kind: 'user', seq: 99, content: [{ type: 'text', text: childState.userText }] }]),
      ],
    }),
    subscribe: (fn: () => void) => {
      childListeners.add(fn)
      return () => { childListeners.delete(fn) }
    },
    cancel,
    // updateQueue 面（off-face 探测）：remove 即从模拟队列里删掉。
    updateQueue: vi.fn(async (itemId: string, action: { kind: string }) => {
      if (action.kind === 'remove') {
        childState.queue = childState.queue.filter(q => q.id !== itemId)
      }
      return { ok: true, value: { accepted: true } }
    }),
    // prompt 面（和解重投用）。
    prompt: vi.fn(async () => ({ ok: true, value: { accepted: true } })),
  }
  const betterSidebar = {
    version: '0.18.0',
    updateTab,
    getSnapshot: () => ({ sessionId: 'parent-1', state: undefined }),
  }
  const ctx = {
    get: (name: string) => (name === 'betterSidebar' ? betterSidebar : undefined),
    sessions: {
      binding: (id: string) => {
        if (id === 'parent-1') return { session: parentSession }
        if (id === childId || id === createdId) return { session: childSession }
        return undefined
      },
      fork,
      create,
      list: { getSnapshot: () => ({ current: 'parent-1', byId: {} }), subscribe: () => () => {} },
    },
    workspaces: { archiveSession: vi.fn(async () => undefined) },
    connection: { api: { sessions: {
      models: vi.fn(async () => ({ result: { ok: false } })),
      selectModel: vi.fn(async () => ({ result: { ok: false } })),
    } } },
  } as unknown as Context
  return {
    ctx,
    fork,
    create,
    cancel,
    updateTab,
    childUpdateQueue: childSession.updateQueue,
    childPrompt: childSession.prompt,
    childQueue: () => childState.queue,
    flipChildRunning: () => {
      childState.running = true
      for (const fn of [...childListeners]) fn()
    },
    setChildUserText: (text: string) => { childState.userText = text },
    lastMeta: () => lastMeta,
  }
}

/** 当前 env 的子会话 id（childSeq 递增，取最近一次 makeEnv 的值）。 */
function currentChildId(): string { return `child-${childSeq}` }

describe('sessionBusyOf（主线忙碌判定）', () => {
  it('running=true → busy；running=false 且无 pending → idle', () => {
    const busy = makeEnv({ parentRunning: true })
    expect(sessionBusyOf(busy.ctx, 'parent-1')).toBe(true)
    const idle = makeEnv({ parentRunning: false })
    expect(sessionBusyOf(idle.ctx, 'parent-1')).toBe(false)
  })

  it('binding 抛错 → fail-open 按空闲（不卡死）', () => {
    const ctx = { sessions: { binding: () => { throw new Error('unknown session') } } } as unknown as Context
    expect(sessionBusyOf(ctx, 'gone')).toBe(false)
  })
})

describe('forkAndRegister：busy fork 路径', () => {
  it('主线空闲 → 直接 fork，无 forkedMidTurn 标记，无监护', async () => {
    const env = makeEnv({ parentRunning: false })
    await expect(forkAndRegister(env.ctx, 'parent-1', 'tab1')).resolves.toBe(currentChildId())
    expect(env.fork).toHaveBeenCalledWith({ sessionId: 'parent-1' })
    expect(env.create).not.toHaveBeenCalled()
    expect(env.lastMeta()?.childId).toBe(currentChildId())
    expect(env.lastMeta()?.forkedMidTurn).toBeUndefined()
    expect(isPurgingInheritedTurn(currentChildId())).toBe(false)
  })

  it('主线忙碌 → 立即 fork（不等待）+ meta 打 forkedMidTurn + 监护就位', async () => {
    const env = makeEnv({ parentRunning: true })
    await expect(forkAndRegister(env.ctx, 'parent-1', 'tab1')).resolves.toBe(currentChildId())
    expect(env.fork).toHaveBeenCalledTimes(1)
    expect(env.lastMeta()?.forkedMidTurn).toBe(true)
    // 监护已就位（等遗传 turn 开跑）。
    expect(isPurgingInheritedTurn(currentChildId())).toBe(true)
    expect(env.cancel).not.toHaveBeenCalled()
  })

  it('遗传 turn 开跑（running 翻 true）→ 立即 cancel 且监护一次性解除并标 inheritedPurged', async () => {
    const env = makeEnv({ parentRunning: true })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    // 无前缀可判 → 纯时序判别：首个用户节点即遗传 turn（生产上 turn 开跑
    // 必然带用户消息节点；无前缀时 inbox 里唯一可能自动开跑的就是它）。
    env.setChildUserText('主线在飞任务（无前缀可判形态）')
    env.flipChildRunning()
    expect(env.cancel).toHaveBeenCalledTimes(1)
    await new Promise(r => setTimeout(r, 10))
    expect(isPurgingInheritedTurn(currentChildId())).toBe(false)
    expect(env.lastMeta()?.inheritedPurged).toBe(true)
    // 用户自己的 turn 不受监护：再次翻 running 不再 cancel。
    env.flipChildRunning()
    expect(env.cancel).toHaveBeenCalledTimes(1)
  })

  it('cancel 后队列和解：用户的孤儿消息（带快照前缀）被 remove + 原样重投', async () => {
    const env = makeEnv({
      parentRunning: true,
      parentInflightText: '主线在飞任务全文',
      childQueue: [
        // cancel 保留 inbox 但不续跑（宿主语义）——用户的真实消息成为孤儿。
        { id: 'user-1', text: '<mainline-progress-snapshot taken-at="x">…</mainline-progress-snapshot>\n\n你现在做到哪了？' },
      ],
    })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    env.setChildUserText('主线在飞任务全文（认领形态）')
    env.flipChildRunning()
    expect(env.cancel).toHaveBeenCalledTimes(1)
    // 和解在 cancel 落定后 ~300ms 触发：孤儿消息 remove + 重投。
    await new Promise(r => setTimeout(r, 500))
    expect(env.childUpdateQueue).toHaveBeenCalledWith('user-1', { kind: 'remove' })
    expect(env.childPrompt).toHaveBeenCalledTimes(1)
  })

  it('文本判别：子会话首个 turn 的消息未命中在飞前缀 → 不 cancel，fail-open 解除', async () => {
    const env = makeEnv({ parentRunning: true, parentInflightText: '主线在飞任务全文' })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    expect(env.lastMeta()?.leakedPromptPrefix).toBe('主线在飞任务全文')
    // 子会话起跑但消息不是遗传的那条（宿主已修好 cut 缺陷的形态）→ 解除。
    env.setChildUserText('用户自己的首个侧边消息')
    env.flipChildRunning()
    expect(env.cancel).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r, 10))
    expect(isPurgingInheritedTurn(currentChildId())).toBe(false)
    expect(env.lastMeta()?.inheritedPurged).toBe(true)
  })

  it('busy 边界排除在飞 turn 节点：继承区用户消息不触发误判（2026-09-23 真机回归）', async () => {
    // 父：已完成轮 [user(1), assistant(2)] + 在飞 [user(3)] + 在飞工具节点(4)。
    // fork 继承只到 seq 2——边界必须是 2，否则子会话里 seq 3+ 的遗传消息
    // 被判成「继承内容」而漏 cancel。
    const env = makeEnv({
      parentRunning: true,
      parentNodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: '旧问题' }] },
        { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '旧回答' }] },
        { kind: 'user', seq: 3, content: [{ type: 'text', text: '在飞任务' }] },
        { kind: 'tool-result', seq: 4, call: { name: 'bash' }, content: [{ type: 'text', text: '...' }] },
      ],
      // 子会话投影带着继承区的 user(1)——若边界错了，它会被当成新消息。
      childInheritedNodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: '旧问题' }] },
        { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '旧回答' }] },
      ],
    })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    expect(env.lastMeta()?.boundarySeq).toBe(2)
    expect(env.lastMeta()?.leakedPromptPrefix).toBe('在飞任务')
    // 只有继承节点存在 → 不触发。
    env.flipChildRunning()
    expect(env.cancel).not.toHaveBeenCalled()
    // 遗传消息落地（seq 99 > 边界 2）→ 命中前缀 → cancel。
    env.setChildUserText('在飞任务')
    env.flipChildRunning()
    expect(env.cancel).toHaveBeenCalledTimes(1)
  })

  it('文本判别：命中在飞前缀 → cancel；running 时节点未至 → 等下一次翻牌再判', async () => {
    const env = makeEnv({ parentRunning: true, parentInflightText: '主线在飞任务全文' })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    // running 先翻、用户消息节点未至 → 不 cancel，继续等。
    env.flipChildRunning()
    expect(env.cancel).not.toHaveBeenCalled()
    // 节点到达（仍 running）→ 命中前缀 → cancel。
    env.setChildUserText('主线在飞任务全文（后半略）')
    env.flipChildRunning()
    expect(env.cancel).toHaveBeenCalledTimes(1)
  })

  it('监护不设静置超时：子会话休眠期任意长，泄漏晚到也拦得住', async () => {
    vi.useFakeTimers()
    try {
      const env = makeEnv({ parentRunning: true })
      await forkAndRegister(env.ctx, 'parent-1', 'tab1')
      const id = currentChildId()
      expect(isPurgingInheritedTurn(id)).toBe(true)
      // 真机实证：子会话直到用户首条消息才认领 inbox——泄漏可能晚到分钟级。
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(isPurgingInheritedTurn(id)).toBe(true)
      env.setChildUserText('主线在飞任务（晚到）')
      env.flipChildRunning()
      expect(env.cancel).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('宿主修好 cut 缺陷的形态：用户首条消息（带快照前缀）到达 → 不误伤，监护解除', async () => {
    const env = makeEnv({ parentRunning: true })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    const id = currentChildId()
    env.setChildUserText('<mainline-progress-snapshot taken-at="x">…快照…</mainline-progress-snapshot>\n\n用户的问题')
    env.flipChildRunning()
    expect(env.cancel).not.toHaveBeenCalled()
    expect(isPurgingInheritedTurn(id)).toBe(false)
  })

  it('监护幂等：同一子会话重复 arm 不叠加（面板重挂载补齐路径）', async () => {
    const env = makeEnv({ parentRunning: true })
    await forkAndRegister(env.ctx, 'parent-1', 'tab1')
    const id = currentChildId()
    // 面板重挂载 effect 的二次 arm（首开路径已 arm）→ 直接返回不叠加。
    armInheritedTurnPurge(env.ctx, id, 'parent-1', 'tab1')
    env.setChildUserText('遗传消息')
    env.flipChildRunning()
    expect(env.cancel).toHaveBeenCalledTimes(1)
  })

  it('主线忙碌 + fork 不可用（零完成轮）→ create 兜底 + snapshotOnly', async () => {
    const env = makeEnv({ parentRunning: true, forkFails: 'unavailable' })
    await expect(forkAndRegister(env.ctx, 'parent-1', 'tab1')).resolves.toBe(`${currentChildId()}-created`)
    expect(env.create).toHaveBeenCalledTimes(1)
    expect(env.lastMeta()?.snapshotOnly).toBe(true)
    expect(env.lastMeta()?.forkedMidTurn).toBe(true)
    // 纯快照会话无泄漏可跑——监护不启用。
    expect(isPurgingInheritedTurn(`${currentChildId()}-created`)).toBe(false)
  })

  it('主线忙碌 + fork 因其他原因失败 → 原样抛错（不兜底）', async () => {
    const env = makeEnv({ parentRunning: true, forkFails: 'other' })
    await expect(forkAndRegister(env.ctx, 'parent-1', 'tab1')).rejects.toThrow('session/not-found')
    expect(env.create).not.toHaveBeenCalled()
  })
})
