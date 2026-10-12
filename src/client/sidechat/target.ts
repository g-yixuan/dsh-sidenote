import type { Context } from '../host/contracts.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { SIDE_TAB_TYPE, collectSideTabs } from './model.ts'
import { betterSidebarOf, directNativeLeg, focusNativeTab, lastLiveSideChat, liveSideChat, liveSideChatsOf, markSideChatOpening, sideChatOpening, subscribeLiveSideChats } from './native.ts'
import { openOrFocusSideChat, sidebarRightOf, sideChatTargetTitle } from './open.ts'

interface TargetChoice { tabId?: string; childId?: string }

export function captureSideChatTarget(ctx: Context, parentId: string) {
  const panel = lastLiveSideChat(parentId)
  const tabs = collectSideTabs(betterSidebarOf(ctx)?.getSnapshot().state)
  const choice: TargetChoice = { tabId: panel?.tabId ?? tabs.at(-1)?.id, childId: panel?.readStatus().childId }
  return { title: sideChatTargetTitle(ctx, parentId), resolve: (signal: AbortSignal) => ensureSideChatTarget(ctx, parentId, signal, choice) }
}

/** Freeze a tab first and wait for that panel's actual child, with no string seed. */
export function ensureSideChatTarget(ctx: Context, parentId: string, signal: AbortSignal, choice?: TargetChoice): Promise<{ childId: string; title: string; isOpen(): boolean }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || currentSessionIdOf(ctx) !== parentId) { reject(new Error('引用来源会话已切换')); return }
    let tabId = choice?.tabId ?? lastLiveSideChat(parentId)?.tabId
    const native = directNativeLeg(ctx)
    const bs = betterSidebarOf(ctx)
    if (tabId === undefined && !native) {
      const tabs = collectSideTabs(bs?.getSnapshot().state)
      tabId = tabs[tabs.length - 1]?.id
    }
    const opening = native ? sideChatOpening(parentId) : undefined
    const requestId = crypto.randomUUID()
    let settled = false
    let seen = tabId === undefined ? undefined : liveSideChat(tabId, parentId)
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = (): void => {}
    const cleanup = (): void => {
      unsubscribe()
      signal.removeEventListener('abort', cancel)
      if (timer !== undefined) clearTimeout(timer)
    }
    const fail = (text: string): void => {
      if (settled) return
      settled = true; cleanup(); reject(new Error(text))
    }
    const cancel = (): void => { fail('已取消保存引用') }
    if (choice?.tabId !== undefined && seen === undefined && (native || !collectSideTabs(bs?.getSnapshot().state).some(tab => tab.id === choice.tabId))) {
      fail('目标侧边聊天已关闭；注解仍在编辑器中'); return
    }
    const check = (): void => {
      if (settled) return
      if (signal.aborted || currentSessionIdOf(ctx) !== parentId) { fail('引用来源会话已切换'); return }
      if (tabId === undefined) {
        tabId = opening?.target?.tabId ?? liveSideChatsOf(parentId).find(panel => panel.readStatus().requestId === requestId)?.tabId
      }
      const panel = tabId === undefined ? undefined : liveSideChat(tabId, parentId)
      if (panel === undefined) { if (seen !== undefined) fail('目标侧边聊天已关闭；注解仍在编辑器中'); return }
      seen = panel
      const status = panel.readStatus()
      if (choice?.childId !== undefined && status.childId !== undefined && status.childId !== choice.childId) { fail('目标侧边会话已改变；请保留注解并重新选择'); return }
      if (status.phase === 'fork-error' || status.phase === 'missing') { fail(status.error ?? '目标侧边聊天未能就绪'); return }
      if (status.phase !== 'chat' || status.childId === undefined) return
      const childId = status.childId
      settled = true; cleanup()
      resolve({ childId, title: panel.readTitle(), isOpen: () => liveSideChat(panel.tabId, parentId) === panel && panel.readStatus().phase === 'chat' && panel.readStatus().childId === childId })
    }
    unsubscribe = subscribeLiveSideChats(check)
    signal.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => fail('目标侧边聊天尚未就绪；请保留注解并重试'), 15_000)
    try {
      if (native && tabId === undefined && opening === undefined) {
        const sidebar = sidebarRightOf(ctx)
        if (sidebar === undefined) { fail('宿主侧边聊天能力不可用'); return }
        sidebar.openTab(SIDE_TAB_TYPE, { params: { parentSessionId: parentId, quoteRequestId: requestId } })
        markSideChatOpening(parentId)
      } else if (choice?.tabId !== undefined) {
        if (native) focusNativeTab(ctx, choice.tabId)
        else bs?.activateTab(choice.tabId, { sessionId: parentId })
      } else if (!native || tabId !== undefined) {
        if (!openOrFocusSideChat(ctx, parentId)) { fail('无法打开目标侧边聊天'); return }
        if (!native && tabId === undefined) {
          const tabs = collectSideTabs(bs?.getSnapshot().state)
          tabId = tabs[tabs.length - 1]?.id
        }
      }
      check()
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  })
}
