/**
 * 完成通知（WI-03，L3 常驻监听层）：侧聊子会话 running true→false 翻转时
 * toast 提醒——用户焦点在主对话时侧聊长任务跑完能被看见（Zed
 * notify_when_agent_waiting 先例）。
 *
 * 事件源是 session.subscribe 快照推送（非轮询）；宿主 notifier 入账不依赖
 * 订阅者——面板不可见（SideChatPanel 的 uSES 断订阅）期间事件不丢。
 * 本层是常驻 ctx.effect：Tab 开闭由 betterSidebar.subscribeState 重扫驱动。
 */
import type { Context } from '../host/contracts.ts'
import { collectSideTabs, parseSideChatMeta } from './model.ts'
import { openSessionWindow } from './lifecycle.ts'
import { showToast } from './toast.tsx'
import { t } from '../locales.ts'

interface Watcher {
  unsub: () => void
  wasRunning: boolean
  /** 建 watcher 的时间——挂接瞬间的 running 翻转（残影）不报。 */
  since: number
}

/** 挂接保护窗：watcher 建立后该窗口内的翻转不视为「一个真实 turn 跑完」。 */
const ATTACH_GRACE_MS = 800

/**
 * 翻转侦测核心（抽出来纯可测）：running true→false 且距挂接超过保护窗
 * 时返回 true。调用方持状态。
 */
export function shouldNotify(wasRunning: boolean, running: boolean, attachedAt: number, now: number): boolean {
  return wasRunning && !running && now - attachedAt > ATTACH_GRACE_MS
}

export function registerCompletionNotify(ctx: Context): void {
  ctx.effect(() => {
    const watchers = new Map<string, Watcher>()

    const rescan = (): void => {
      let tabs: ReturnType<typeof collectSideTabs> = []
      try {
        tabs = collectSideTabs(ctx.betterSidebar.getSnapshot())
      } catch {
        return
      }
      const alive = new Set<string>()
      for (const tab of tabs) {
        const meta = parseSideChatMeta(tab.meta)
        const childId = meta.childId
        if (childId === undefined) continue
        alive.add(childId)
        if (watchers.has(childId)) continue
        // 新侧聊：binding 可能 throw（会话还没就绪）——本轮跳过，下轮重扫补。
        try {
          const session = ctx.sessions.binding(childId)?.session
          if (session === undefined) continue
          openSessionWindow(session)
          const title = tab.title
          const watcher: Watcher = { unsub: () => {}, wasRunning: false, since: Date.now() }
          watcher.unsub = session.subscribe(() => {
            const snap = session.getSnapshot() as { running?: unknown } | null
            const running = snap?.running === true
            if (shouldNotify(watcher.wasRunning, running, watcher.since, Date.now())) {
              showToast(t('sideChatDone', { title }))
            }
            watcher.wasRunning = running
          })
          // 挂接即取一次初值（正在跑的会话稍后跑完时报）。
          watcher.wasRunning = (session.getSnapshot() as { running?: unknown } | null)?.running === true
          watchers.set(childId, watcher)
        } catch {
          // 下轮重扫再试。
        }
      }
      // 清理已关闭 Tab 的 watcher（× 即焚的会话不再报）。
      for (const [id, w] of watchers) {
        if (!alive.has(id)) {
          w.unsub()
          watchers.delete(id)
        }
      }
    }

    const offState = ctx.betterSidebar.subscribeState(rescan)
    rescan()
    return () => {
      offState()
      for (const w of watchers.values()) w.unsub()
      watchers.clear()
    }
  }, 'dsh-sidenote: completion notify')
}
