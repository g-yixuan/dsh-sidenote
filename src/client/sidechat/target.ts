import type { Context } from '../host/contracts.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { collectSideTabs } from './model.ts'
import { betterSidebarOf, directNativeLeg, focusNativeTab, liveSideChat, subscribeLiveSideChats } from './native.ts'
import { createSideChat, openOrFocusSideChat, sideChatTargetTab, sideChatTargetTitle, sideChatTabsOf } from './open.ts'

interface TargetChoice { tabId?: string; childId?: string }

function targetTabId(ctx: Context, parentId: string): string | undefined {
  return directNativeLeg(ctx) ? sideChatTargetTab(ctx, parentId)?.id : collectSideTabs(betterSidebarOf(ctx)?.getSnapshot().state).at(-1)?.id
}

export function captureSideChatTarget(ctx: Context, parentId: string) {
  const tabId = targetTabId(ctx, parentId)
  const choice: TargetChoice = { tabId, childId: tabId ? liveSideChat(tabId, parentId)?.readStatus().childId : undefined }
  return { title: sideChatTargetTitle(ctx, parentId), resolve: (signal: AbortSignal) => ensureSideChatTarget(ctx, parentId, signal, choice) }
}

/** Resolve only the captured tab, even if another tab becomes active while editing. */
export function ensureSideChatTarget(ctx: Context, parentId: string, signal: AbortSignal, choice?: TargetChoice): Promise<{ childId: string; title: string; isOpen(): boolean }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || currentSessionIdOf(ctx) !== parentId) { reject(new Error('引用来源会话已切换')); return }
    const native = directNativeLeg(ctx)
    const bs = betterSidebarOf(ctx)
    let tabId = choice === undefined ? targetTabId(ctx, parentId) : choice.tabId
    let settled = false
    let unsubscribe = (): void => {}
    const exists = (): boolean => (native ? sideChatTabsOf(ctx, parentId) : collectSideTabs(bs?.getSnapshot().state)).some(tab => tab.id === tabId)
    const cleanup = (): void => {
      unsubscribe()
      signal.removeEventListener('abort', cancel)
    }
    const fail = (text: string): void => {
      if (settled) return
      settled = true; cleanup(); reject(new Error(text))
    }
    const cancel = (): void => { fail('已取消保存引用') }
    const check = (): void => {
      if (settled || tabId === undefined) return
      if (signal.aborted || currentSessionIdOf(ctx) !== parentId) { fail('引用来源会话已切换'); return }
      if (!exists()) { fail('目标侧边聊天已关闭；注解仍在编辑器中'); return }
      const panel = liveSideChat(tabId, parentId)
      if (!panel) return
      const status = panel.readStatus()
      if (choice?.childId !== undefined && status.childId !== undefined && status.childId !== choice.childId) { fail('目标侧边会话已改变；请保留注解并重新选择'); return }
      if (status.phase === 'fork-error' || status.phase === 'missing') { fail(status.error ?? '目标侧边聊天未能就绪'); return }
      if (status.phase !== 'chat' || status.childId === undefined) return
      const childId = status.childId
      settled = true; cleanup()
      resolve({ childId, title: panel.readTitle(), isOpen: () => exists() && liveSideChat(panel.tabId, parentId) === panel && panel.readStatus().phase === 'chat' && panel.readStatus().childId === childId })
    }
    unsubscribe = subscribeLiveSideChats(check)
    signal.addEventListener('abort', cancel, { once: true })
    // Native forks of long histories can legitimately take more than 15 seconds.
    // Completion, target closure and the caller's AbortSignal own this lifetime.
    try {
      if (tabId !== undefined) {
        if (!exists()) { fail('目标侧边聊天已关闭；注解仍在编辑器中'); return }
        if (native) focusNativeTab(ctx, tabId)
        else bs?.activateTab(tabId, { sessionId: parentId })
      } else {
        // No tab at capture time means a new side chat, not whichever appeared later.
        const open = choice === undefined ? openOrFocusSideChat : createSideChat
        if (!open(ctx, parentId)) { fail('无法打开目标侧边聊天'); return }
        tabId = targetTabId(ctx, parentId)
        if (!tabId) { fail('无法确定目标侧边聊天'); return }
      }
      check()
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  })
}
