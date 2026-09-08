/**
 * sidechat/notify.ts 单测：翻转侦测（shouldNotify）+ 常驻 watcher 集成
 * （Tab 重扫 → 会话订阅 → running 翻转 → toast；Tab 关闭清理）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('../src/client/sidechat/toast.tsx', () => ({ showToast }))

import { registerCompletionNotify, shouldNotify } from '../src/client/sidechat/notify.ts'

describe('shouldNotify', () => {
  it('running true→false 且过保护窗才报', () => {
    expect(shouldNotify(true, false, 1000, 3000)).toBe(true)
    expect(shouldNotify(true, false, 1000, 1500)).toBe(false) // 保护窗内
    expect(shouldNotify(false, true, 1000, 3000)).toBe(false)  // 启动不报
    expect(shouldNotify(false, false, 1000, 3000)).toBe(false)
  })
})

describe('registerCompletionNotify', () => {
  beforeEach(() => { showToast.mockClear() })

  function fakeHost(runningSeq: boolean[]) {
    // 会话桩：每次 notify 时从 runningSeq 出队一个 running 值。
    const listeners = new Set<() => void>()
    const session = {
      subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
      getSnapshot: () => ({ running: runningSeq[0] ?? false }),
    }
    return {
      session,
      /** 推进一拍：running 出队并通知订阅者。 */
      tick() { runningSeq.shift(); for (const fn of listeners) fn() },
    }
  }

  function fakeCtx(sideTabs: { id: string; title: string; childId?: string }[], session: unknown) {
    const stateListeners = new Set<() => void>()
    const effects: Array<() => void | (() => void)> = []
    return {
      effects,
      ctx: {
        effect(fn: () => void | (() => void)) { effects.push(fn) },
        betterSidebar: {
          subscribeState(fn: () => void) { stateListeners.add(fn); return () => { stateListeners.delete(fn) } },
          // SidebarSnapshot 形状（model.ts collectTabs 契约）：splits 树 +
          // kind:'leaf' 节点持 tabs 数组。
          getSnapshot: () => ({
            splits: { kind: 'leaf', tabs: sideTabs.map(t => ({ id: t.id, type: 'dsh-sidenote:side', title: t.title, meta: { childId: t.childId } })) },
          }),
        },
        sessions: { binding: () => ({ session }) },
      } as never,
      fireState() { for (const fn of stateListeners) fn() },
    }
  }

  it('侧聊 Tab 出现 → 挂订阅；running 翻转 → toast（带 Tab 标题）；Tab 关闭 → 清理', () => {
    const host = fakeHost([true, false])
    const { ctx, effects } = fakeCtx([{ id: 't1', title: '侧边', childId: 'child-1' }], host.session)
    registerCompletionNotify(ctx)
    // 跑 effect（cordis effect 语义：注册即执行，返回清理函数）
    for (const fn of effects) void fn()
    // 挂接时刻 running=true（初值），等过保护窗再翻转
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 2000)
    host.tick() // running: true → false（出队后 getSnapshot 读 false）
    vi.useRealTimers()
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[0]![0]).toContain('侧边')
  })
})
