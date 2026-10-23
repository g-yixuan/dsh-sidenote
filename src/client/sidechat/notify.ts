/** Observe durable completed turns for live side chats, including hidden panels. */
import type { Context } from '../host/contracts.ts'
import { openSessionWindow, isPurgingInheritedTurn } from './lifecycle.ts'
import { sideChatMetaStore, sideChatMetasAll } from './metaStore.ts'
import { sideChatTitleOf } from './identity.ts'
import { chatSourceOf } from '../host/chat.ts'
import { subscribeLiveSideChats } from './native.ts'
import { showToast } from './toast.tsx'
import { t } from '../locales.ts'

interface Watcher {
  unsub: () => void
  wasRunning: boolean
  lastEndSeq: number
}

export function registerCompletionNotify(ctx: Context): void {
  ctx.effect(() => {
    const watchers = new Map<string, Watcher>()

    // 枚举当前存活侧聊的 (childId, title)：直连腿读 metaStore（记录由面板
    // reconcile 创建、关闭检测清场，有记录即存活；childId 在 fork 完成后
    // 才登记）；legacy 腿读布局快照。
    const collectAlive = (): Array<{ childId: string, title: string }> => sideChatMetasAll().flatMap(meta => meta.childId === undefined ? [] : [{ childId: meta.childId, title: sideChatTitleOf(meta) }])

    const rescan = (): void => {
      let tabs: Array<{ childId: string, title: string }> = []
      try {
        tabs = collectAlive()
      } catch {
        return
      }
      const alive = new Set<string>()
      for (const { childId } of tabs) {
        alive.add(childId)
        if (watchers.has(childId)) continue
        // 新侧聊：binding 可能 throw（会话还没就绪）——本轮跳过，下轮重扫补。
        try {
          const session = ctx.sessions.binding(childId)?.session
          if (session === undefined) continue
          openSessionWindow(session)
          const chat = chatSourceOf(ctx, ctx.sessions.binding(childId))
          const watcher: Watcher = { unsub: () => {}, wasRunning: session.getSnapshot().running === true, lastEndSeq: chat?.getLastTurnEnd?.()?.seq ?? -1 }
          const check = (): void => {
            const running = session.getSnapshot().running === true
            if (isPurgingInheritedTurn(childId)) { watcher.wasRunning = running; return }
            const end = chat?.getLastTurnEnd?.()
            if (end && end.seq > watcher.lastEndSeq) {
              if (end.reason === 'completed' && watcher.wasRunning) {
                const title = collectAlive().find(entry => entry.childId === childId)?.title ?? t('tabBaseTitle')
                showToast(t('sideChatDone', { title }))
              }
              watcher.lastEndSeq = end.seq
              watcher.wasRunning = running
            } else if (running) watcher.wasRunning = true
          }
          const offSession = session.subscribe(check)
          const offChat = chat?.subscribe(check)
          watcher.unsub = () => { offSession(); offChat?.() }
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

    // 重扫驱动：直连腿 = metaStore 变更（reconcile/childId 登记/关闭清场都会
    // notify）；legacy 腿 = betterSidebar 布局状态订阅。
    const offState = sideChatMetaStore.subscribe(rescan)
    const offLive = subscribeLiveSideChats(rescan)
    rescan()
    return () => {
      offState()
      offLive()
      for (const w of watchers.values()) w.unsub()
      watchers.clear()
    }
  }, 'dsh-sidenote: completion notify')
}
