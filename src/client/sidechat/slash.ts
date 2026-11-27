/** /side opens a session-scoped selector for new, open and closed side chats. */
import { createElement, useSyncExternalStore } from 'react'
import type { Context } from '../host/contracts.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { canForkFrom, collectSideTabs, parseSideChatMeta } from './model.ts'
import { betterSidebarOf, directNativeLeg, focusNativeTab, sideChatOpening } from './native.ts'
import { createSideChat, reopenSideChat, sideChatTabsOf } from './open.ts'
import { dropClosedSideChat, listClosedSideChats } from './recentClosed.ts'
import { formatClosedAt, sideChatTitleOf } from './identity.ts'
import { t } from '../locales.ts'
import { SideChatMenu, type SideMenuItem } from './SideChatMenu.tsx'

interface CommandSession { readonly sessionId: string }
interface CommandUiService {
  register(contribution: {
    readonly name: string
    readonly description: () => string
    available(session: CommandSession): boolean
    readonly ui: { readonly kind: 'action'; run(session: CommandSession): void }
  }): () => void
}

export function sideMenuItems(ctx: Context, sessionId: string): SideMenuItem[] {
  const items: SideMenuItem[] = [{ kind: 'new', id: 'new', label: t('cmdNew'), detail: t('cmdNewDetail') }]
  const openChildren = new Set<string>()
  if (directNativeLeg(ctx)) {
    for (const tab of sideChatTabsOf(ctx, sessionId)) {
      const meta = tab.meta
      const child = meta?.childId ?? sideChatOpening(sessionId, tab.id)?.childId
      if (child) openChildren.add(child)
      items.push({ kind: 'focus', id: tab.id, label: t('cmdFocus', { title: meta ? sideChatTitleOf(meta) : tab.title }), detail: t('cmdFocusDetail') })
    }
  } else {
    const snapshot = betterSidebarOf(ctx)?.getSnapshot()
    if (snapshot?.sessionId === sessionId && snapshot.state !== undefined) {
      for (const tab of collectSideTabs(snapshot.state)) {
        const child = parseSideChatMeta(tab.meta).childId
        if (child) openChildren.add(child)
        items.push({ kind: 'focus', id: tab.id, label: t('cmdFocus', { title: tab.title }), detail: t('cmdFocusDetail') })
      }
    }
  }
  for (const entry of listClosedSideChats(sessionId)) {
    if (openChildren.has(entry.childId)) continue
    const title = entry.topic ?? entry.title
    items.push({ kind: 'reopen', id: entry.childId, title, label: t('cmdReopen', { title }), detail: formatClosedAt(entry.closedAt) })
  }
  return items
}

export function selectSideMenuItem(ctx: Context, sessionId: string, item: SideMenuItem): boolean {
  if (currentSessionIdOf(ctx) !== sessionId) return false
  if (item.kind === 'new') return createSideChat(ctx, sessionId)
  if (item.kind === 'focus') {
    if (!sideMenuItems(ctx, sessionId).some(row => row.kind === 'focus' && row.id === item.id)) return false
    if (focusNativeTab(ctx, item.id)) return true
    const sidebar = betterSidebarOf(ctx)
    if (!sidebar) return false
    sidebar.activateTab(item.id, { sessionId })
    return true
  }
  const entry = listClosedSideChats(sessionId).find(e => e.childId === item.id)
  if (!entry) return false
  if (!reopenSideChat(ctx, sessionId, item.id, { topic: entry.topic, savedMeta: entry.savedMeta })) return false
  dropClosedSideChat(sessionId, item.id)
  return true
}

export function removeSideMenuItem(ctx: Context, sessionId: string, item: SideMenuItem): boolean {
  if (currentSessionIdOf(ctx) !== sessionId || item.kind !== 'reopen' || !sideMenuItems(ctx, sessionId).some(row => row.kind === 'reopen' && row.id === item.id)) return false
  return dropClosedSideChat(sessionId, item.id)
}

export function registerSideCommand(ctx: Context): void {
  let commandUi: CommandUiService | undefined
  try { commandUi = ctx.get('commandUi') as CommandUiService | undefined }
  catch { return }
  if (!commandUi?.register) return
  // The host picker has no secondary row action. Use its composer overlay slot
  // and action command contract to keep the menu scoped to the invoking session.
  let sequence = 0
  let request: { sessionId: string; sequence: number } | undefined
  const listeners = new Set<() => void>()
  const publish = (next: typeof request): void => {
    request = next
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const snapshot = () => request
  function Overlay({ sessionId }: { sessionId: string }) {
    const opened = useSyncExternalStore(subscribe, snapshot)
    if (opened?.sessionId !== sessionId) return null
    return createElement(SideChatMenu, {
      key: opened.sequence,
      readItems: () => sideMenuItems(ctx, sessionId),
      onSelect: item => selectSideMenuItem(ctx, sessionId, item),
      onRemove: item => removeSideMenuItem(ctx, sessionId, item),
      onClose: () => { if (request === opened) publish(undefined) },
    })
  }
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'dsh-sidenote-side-menu', order: 1,
    inject: sessionId => ({ sessionId }),
  }, Overlay))
  for (const name of ['side', '侧边']) {
    ctx.effect(() => commandUi.register({
      name, description: () => t('cmdDesc'),
      available: session => canForkFrom(ctx, session.sessionId),
      ui: { kind: 'action', run: session => publish({ sessionId: session.sessionId, sequence: ++sequence }) },
    }), `dsh-sidenote: /${name} command`)
  }
}
