import type { Context } from './contracts.ts'
import { currentSessionIdOf } from './currentSession.ts'
import { probeInput, type CapabilityState, type InputReason } from './input.ts'
import { chatSourceOf } from './chat.ts'
import { composerSeat, MAIN_ASSISTANT, hasConversationMessages } from './dom.ts'
import { betterSidebarOf, directNativeLeg, rootContext } from './sidebar.ts'
import { remoteSessionFace } from './models.ts'
import { hasConfirmedAcceptance } from './submission.ts'

declare const __SIDENOTE_VERSION__: string
export type DiagnosticReason = InputReason | 'waitView' | 'waitDock' | 'waitSide' | 'unknownAcceptance' | 'markersMissing'
export interface Capability {
  id: string
  name: 'selection' | 'dock' | 'sideOpen' | 'sideQuote' | 'input' | 'sideInput' | 'acceptance' | 'sideAcceptance' | 'chat' | 'model'
  state: CapabilityState
  reason: DiagnosticReason
  path: string
}
export interface HostReport {
  versions: { sidenote: string; dsh: string; betterSidebar: string | null }
  capabilities: readonly Capability[]
}

export interface HostDiagnostics {
  getSnapshot(): HostReport
  subscribe(fn: () => void): () => void
  recheck(): void
  dockRegistered(): void
}

const stores = new WeakMap<Context, HostDiagnostics>()

/** A report contains software facts only: no session IDs, prompts, URLs or paths. */
export function hostDiagnostics(ctx: Context): HostDiagnostics {
  const owner = rootContext(ctx)
  const existing = stores.get(ctx) ?? stores.get(owner)
  if (existing !== undefined) return existing
  const listeners = new Set<() => void>()
  let dockRegistered = false
  let report: HostReport = { versions: { sidenote: typeof __SIDENOTE_VERSION__ === 'string' ? __SIDENOTE_VERSION__ : 'unknown', dsh: 'unknown', betterSidebar: null }, capabilities: [] }
  const recheck = (): void => {
    const capabilities: Capability[] = []
    const add = (name: Capability['name'], state: CapabilityState, reason: DiagnosticReason, path: string, id: string = name): void => {
      const entry = { id, name, state, reason, path }
      const at = capabilities.findIndex(capability => capability.id === id)
      if (at === -1) capabilities.push(entry)
      else capabilities[at] = entry
    }
    try {
      const id = currentSessionIdOf(ctx)
      const binding = id === '' ? undefined : ctx.sessions.binding(id)
      const chat = chatSourceOf(ctx, binding)
      const legacy = chat?.getLegacy()
      const hasSource = typeof document !== 'undefined' && document.querySelector(MAIN_ASSISTANT) !== null
      const hasAssistant = legacy?.nodes.some(node => (node as { kind?: string }).kind === 'assistant') === true
      add('selection', hasSource ? 'available' : hasAssistant && hasConversationMessages() ? 'unknown' : 'unready', hasSource ? 'ready' : hasAssistant ? 'markersMissing' : 'waitView', 'main assistant DOM')
      const dockReady = dockRegistered && composerSeat() !== null
      add('dock', dockReady ? 'available' : 'unready', dockReady ? 'ready' : dockRegistered ? 'waitView' : 'waitDock', 'conversation.input.dock')
      const input = probeInput(ctx, id)
      add('input', input.state, input.reason, input.path)
      add('chat', legacy === undefined || legacy === null ? 'unready' : 'available', legacy ? 'ready' : 'waitSession', 'chatSourceOf')
      add('acceptance', hasConfirmedAcceptance(binding) ? 'available' : 'unknown', hasConfirmedAcceptance(binding) ? 'ready' : 'unknownAcceptance', 'durable user/steering or native Queue/Inbox')
      const bs = betterSidebarOf(ctx)
      const native = directNativeLeg(ctx)
      const sidebar = native ? ctx.get('sidebarRight') as { openTab?: unknown } | undefined : bs
      const sideReady = typeof sidebar?.openTab === 'function'
      add('sideOpen', sideReady ? 'available' : sidebar == null ? 'unready' : 'unavailable', sideReady ? 'ready' : sidebar == null ? 'waitService' : 'unsupported', native ? 'sidebarRight.openTab' : 'betterSidebar.openTab')
      const sides = typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLElement>('[data-sidenote-chat-session]')].filter(element => element.getClientRects().length > 0)
      const sideQuoteReady = sides.some(side => side.querySelector('[data-sidenote-quote-body][data-sidenote-streaming="false"]'))
      add('sideQuote', sideQuoteReady ? 'available' : 'unready', sideQuoteReady ? 'ready' : sides.length > 0 ? 'waitView' : 'waitSide', 'owned side assistant body')
      for (const [index, side] of sides.entries()) {
        const sideInput = probeInput(ctx, side.dataset.sidenoteChatSession ?? '')
        add('sideInput', sideInput.state, sideInput.reason, sideInput.path, `side-input-${index + 1}`)
        const sideBinding = ctx.sessions.binding(side.dataset.sidenoteChatSession ?? '')
        add('sideAcceptance', hasConfirmedAcceptance(sideBinding) ? 'available' : 'unknown', hasConfirmedAcceptance(sideBinding) ? 'ready' : 'unknownAcceptance', 'durable user/steering or native Queue/Inbox', `side-acceptance-${index + 1}`)
      }
      const remote = remoteSessionFace(ctx)
      const legacyModels = ctx.connection?.api?.sessions
      const modelReady = (typeof remote?.selectModel === 'function' && typeof remote.modelCatalog === 'function')
        || (typeof legacyModels?.models === 'function' && typeof legacyModels.selectModel === 'function')
      const providedRemote = ctx.get('remote.session') ?? (ctx.get('remote') as { session?: unknown } | undefined)?.session
      const modelProvided = providedRemote != null || typeof legacyModels?.models === 'function' || typeof legacyModels?.selectModel === 'function'
      add('model', modelReady ? 'available' : modelProvided ? 'unavailable' : 'unready', modelReady ? 'ready' : modelProvided ? 'unsupported' : 'waitService', providedRemote ? 'remote.session' : 'connection.api.sessions')
      const next = { versions: { ...report.versions, betterSidebar: typeof bs?.version === 'string' ? bs.version : null }, capabilities }
      if (JSON.stringify(next) !== JSON.stringify(report)) { report = next; for (const fn of [...listeners]) fn() }
    } catch {
      add('chat', 'unknown', 'readFailed', 'host state read')
      const next = { ...report, capabilities }
      if (JSON.stringify(next) !== JSON.stringify(report)) { report = next; for (const fn of [...listeners]) fn() }
    }
  }
  const store: HostDiagnostics = {
    getSnapshot: () => report,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    recheck,
    dockRegistered() { dockRegistered = true; recheck() },
  }
  stores.set(ctx, store)
  recheck()
  return store
}

/** Recheck at service readiness and view changes; absence at boot is waiting. */
export function watchHostDiagnostics(ctx: Context): () => void {
  const store = hostDiagnostics(ctx)
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => { if (timer !== undefined) clearTimeout(timer); timer = setTimeout(store.recheck, 100) }
  const offList = ctx.sessions.list.subscribe(schedule)
  const observer = new MutationObserver(records => {
    if (records.every(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-sidenote-compatibility]'))) return
    schedule()
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded', 'data-sidenote-chat-session', 'data-conversation-session', 'data-sidenote-streaming'] })
  for (const service of ['conversation', 'uiConversation', 'sidebarRight', 'betterSidebar', 'remote']) {
    ctx.inject([service], () => { schedule() })
  }
  return () => { observer.disconnect(); offList(); if (timer !== undefined) clearTimeout(timer) }
}

export function probeHost(ctx: Context): number {
  const status = hostDiagnostics(ctx)
  status.recheck()
  return status.getSnapshot().capabilities.filter(item => item.state === 'unavailable').length
}
