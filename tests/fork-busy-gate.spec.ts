/**
 * fork 护栏（waitForSessionIdle + sessionBusyOf）单测。
 *
 * 守护的事故形态（2026-09-22 真机实证）：主线 turn 在飞时 fork，宿主把在飞
 * 消息以未认领 inbox splice 遗传给子会话——子会话替主线执行任务，用户真正
 * 的侧边消息排进不可见队列。因此 forkAndRegister 必须先等主线空闲。
 */
import { describe, expect, it, vi } from 'vitest'
import { forkAndRegister, sessionBusyOf, waitForSessionIdle } from '../src/client/sidechat/lifecycle.ts'
import type { Context } from '../src/client/host/contracts.ts'

/** 最小宿主假身：一个可控 running/pending 的父会话 + fork/archive/模型桩。 */
function makeCtx(parent: {
  running: boolean
  pending?: readonly unknown[]
}): { ctx: Context; fork: ReturnType<typeof vi.fn>; notify: () => void } {
  const listeners = new Set<() => void>()
  const session = {
    getSnapshot: () => ({ running: parent.running, pending: parent.pending ?? [], nodes: [] }),
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const fork = vi.fn(async () => 'child-1')
  const ctx = {
    get: () => undefined, // betterSidebar / uiConversation 均缺席
    sessions: {
      binding: (id: string) => (id === 'parent-1' ? { session } : undefined),
      fork,
    },
    workspaces: { archiveSession: vi.fn(async () => undefined) },
    connection: { api: { sessions: {
      models: vi.fn(async () => ({ result: { ok: false } })),
      selectModel: vi.fn(async () => ({ result: { ok: false } })),
    } } },
  } as unknown as Context
  return { ctx, fork, notify: () => { for (const fn of [...listeners]) fn() } }
}

describe('sessionBusyOf（主线忙碌判定）', () => {
  it('running=true → busy；running=false 且无 pending → idle', () => {
    const { ctx } = makeCtx({ running: true })
    expect(sessionBusyOf(ctx, 'parent-1')).toBe(true)
    const idle = makeCtx({ running: false })
    expect(sessionBusyOf(idle.ctx, 'parent-1')).toBe(false)
  })

  it('pending 非空（审批/提问挂起）→ busy', () => {
    const { ctx } = makeCtx({ running: false, pending: [{}] })
    expect(sessionBusyOf(ctx, 'parent-1')).toBe(true)
  })

  it('binding 抛错/缺席 → fail-open 按空闲（fork 错误面兜底，不卡死）', () => {
    const ctx = { sessions: { binding: () => { throw new Error('unknown session') } } } as unknown as Context
    expect(sessionBusyOf(ctx, 'gone')).toBe(false)
  })
})

describe('waitForSessionIdle（fork 前的空闲等待）', () => {
  it('主线空闲 → 同步返回，不挂起', async () => {
    const { ctx } = makeCtx({ running: false })
    await waitForSessionIdle(ctx, 'parent-1')
  })

  it('主线忙碌 → 等到翻闲后才 resolve（订阅通道驱动）', async () => {
    const parent = { running: true }
    const { ctx, notify } = makeCtx(parent)
    let resolved = false
    const p = waitForSessionIdle(ctx, 'parent-1').then(() => { resolved = true })
    await new Promise(r => setTimeout(r, 10))
    expect(resolved).toBe(false)
    parent.running = false
    notify()
    await p
    expect(resolved).toBe(true)
  })

  it('主线忙碌且订阅面不翻牌 → 轮询兜底（1.5s）', async () => {
    const parent = { running: true }
    const { ctx } = makeCtx(parent)
    const p = waitForSessionIdle(ctx, 'parent-1')
    parent.running = false // 不 notify——只靠轮询
    await p // 若轮询失效此 Promise 永不 resolve，测试超时即失败
  }, 5000)

  it('signal 中止 → reject AbortError', async () => {
    const { ctx } = makeCtx({ running: true })
    const controller = new AbortController()
    const p = waitForSessionIdle(ctx, 'parent-1', controller.signal)
    controller.abort()
    await expect(p).rejects.toThrowError(/aborted/i)
  })

  it('signal 进入时已中止 → 立即 reject', async () => {
    const parent = { running: true }
    const { ctx } = makeCtx(parent)
    const controller = new AbortController()
    controller.abort()
    await expect(waitForSessionIdle(ctx, 'parent-1', controller.signal)).rejects.toThrowError(/aborted/i)
  })
})

describe('forkAndRegister 护栏接线', () => {
  it('主线空闲 → 直接 fork 并登记 childId', async () => {
    const { ctx, fork } = makeCtx({ running: false })
    // legacy 腿（betterSidebar 在场且 < 0.19）使 updateTabMeta 走 BS 桩，
    // 避开直连腿 metaStore 的 localStorage 依赖（node 环境无 localStorage）。
    const updateTab = vi.fn()
    const legged = {
      ...ctx as object,
      betterSidebar: { version: '0.18.0', updateTab, getSnapshot: () => ({ sessionId: 'parent-1', state: undefined }) },
    } as unknown as Context
    await expect(forkAndRegister(legged, 'parent-1', 'tab1')).resolves.toBe('child-1')
    expect(fork).toHaveBeenCalledWith({ sessionId: 'parent-1' })
    expect(updateTab).toHaveBeenCalled()
  })

  it('主线忙碌 → fork 延迟到空闲后发生（期间不 fork）', async () => {
    const parent = { running: true }
    const { ctx, fork, notify } = makeCtx(parent)
    const legged = {
      ...ctx as object,
      betterSidebar: { version: '0.18.0', updateTab: vi.fn(), getSnapshot: () => ({ sessionId: 'parent-1', state: undefined }) },
    } as unknown as Context
    const p = forkAndRegister(legged, 'parent-1', 'tab1')
    await new Promise(r => setTimeout(r, 20))
    expect(fork).not.toHaveBeenCalled()
    parent.running = false
    notify()
    await expect(p).resolves.toBe('child-1')
    expect(fork).toHaveBeenCalledTimes(1)
  })

  it('等待期间中止（关 tab）→ reject 且不 fork', async () => {
    const { ctx, fork } = makeCtx({ running: true })
    const legged = {
      ...ctx as object,
      betterSidebar: { version: '0.18.0', updateTab: vi.fn(), getSnapshot: () => ({ sessionId: 'parent-1', state: undefined }) },
    } as unknown as Context
    const controller = new AbortController()
    const p = forkAndRegister(legged, 'parent-1', 'tab1', controller.signal)
    controller.abort()
    await expect(p).rejects.toThrowError(/aborted/i)
    expect(fork).not.toHaveBeenCalled()
  })
})
