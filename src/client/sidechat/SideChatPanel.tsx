/** Side-chat lifecycle and product extensions around the shared Conversation. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { SessionReference, TabComponentProps } from '../host/contracts.ts'
import { focusMainComposer, focusSideComposer } from '../host/dom.ts'
import { sessionStatusSource } from '../host/chat.ts'
import { useComposer } from './composer.ts'
import { appendDraftText, clearPendingDraft, pairQuestions, parseSideChatMeta, phaseOf } from './model.ts'
import { transcriptOf } from '../chat/transcript.ts'
import { StateScreen } from './rows.tsx'
import { armInheritedTurnPurge, chatSourceOf, ensurePanelOpen, forkAndRegister, openSession, openSessionWindow, retainSession, saveSideChatSession, setSideChatTopic, unarchiveSideSession, updateTabMeta } from './lifecycle.ts'
import { topicOf } from './identity.ts'
import { buildMainlineSnapshot } from './snapshot.ts'
import { registerLiveSideChat, notifyLiveSideChats } from './native.ts'
import { dropClosedSideChat, recordClosedSideChat } from './recentClosed.ts'
import type { ReflowStore } from '../reflow.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import { registerSubmissionExtras } from '../annotations/submissionExtras.ts'
import { addReply, finalReplies, isReplyAdded, type RenderConversation, type SideConversation } from './NativeConversation.tsx'
import { showToast } from './toast.tsx'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

const NOOP_UNSUBSCRIBE = (): void => {}

export function SideChatPanel(props: TabComponentProps & { reflow: ReflowStore; annotations: AnnotationStore; renderConversation: RenderConversation; quoteRequestId?: string }) {
  useLocaleTick()
  const { ctx, scope, tab, visible } = props
  const meta = parseSideChatMeta(tab.meta)
  const childId = meta.childId
  const [forkError, setForkError] = useState<string | null>(null)
  const [reference, setReference] = useState<SessionReference>()
  const forkStarted = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { ensurePanelOpen(props.store) }, [props.store])
  useEffect(() => {
    if (childId !== undefined || forkStarted.current) return
    forkStarted.current = true
    const controller = new AbortController()
    void forkAndRegister(ctx, scope.sessionId, tab.id, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) setForkError(error instanceof Error ? error.message : String(error))
    })
    return () => { controller.abort() }
  }, [ctx, scope.sessionId, tab.id, childId])
  useEffect(() => {
    if (childId === undefined) return
    const acquired = retainSession(ctx, childId)
    setReference(acquired)
    unarchiveSideSession(ctx, childId)
    let active = true
    void acquired?.ready.catch((error: unknown) => { if (active) setForkError(String(error)) })
    return () => { active = false; acquired?.release() }
  }, [ctx, childId])
  const list = useSyncExternalStore(useCallback(notify => ctx.sessions.list.subscribe(notify), [ctx]), () => ctx.sessions.list.getSnapshot())
  const binding = childId === undefined ? undefined : ctx.sessions.binding(childId)
  const session = binding?.session
  const phase = phaseOf({ childId, forkError, bound: session !== undefined, listPhase: list.phase, listed: childId !== undefined && list.byId?.[childId] !== undefined })
  useEffect(() => {
    if (meta.forkedMidTurn && !meta.inheritedPurged && childId && session) armInheritedTurnPurge(ctx, childId, scope.sessionId, tab.id, meta.leakedPromptPrefix, meta.boundarySeq)
    openSessionWindow(session)
  }, [ctx, session, childId, scope.sessionId, tab.id, meta.forkedMidTurn, meta.inheritedPurged, meta.leakedPromptPrefix, meta.boundarySeq])
  const snapshot = useSyncExternalStore(useCallback(notify => session?.subscribe(notify) ?? NOOP_UNSUBSCRIBE, [session]), () => session?.getSnapshot() ?? null)
  const chat = useMemo(() => chatSourceOf(ctx, binding), [ctx, childId, session])
  const legacy = useSyncExternalStore(useCallback(notify => chat?.subscribe(notify) ?? NOOP_UNSUBSCRIBE, [chat]), () => chat?.getLegacy() ?? null)
  const messages = useMemo(() => transcriptOf(legacy ?? snapshot), [legacy, snapshot])
  const metaRef = useRef(meta)
  metaRef.current = meta
  const extras = useMemo(() => ({
    firstSendPrefix: (): string | null => {
      const current = metaRef.current
      return current.forkedMidTurn && current.parentSessionId ? buildMainlineSnapshot(ctx, current.parentSessionId) : null
    },
    onAccepted: (): void => { updateTabMeta(ctx, scope.sessionId, tab.id, current => ({ ...current, forkedMidTurn: undefined })) },
    onSubmitText: (text: string): void => {
      const topic = topicOf(text)
      if (topic && metaRef.current.topic === undefined) setSideChatTopic(ctx, scope.sessionId, tab.id, topic)
    },
  }), [ctx, scope.sessionId, tab.id])
  const composer = useComposer(ctx, session, childId)
  useEffect(() => childId === undefined ? undefined : registerSubmissionExtras(childId, extras), [childId, extras])
  useEffect(() => {
    if (meta.topic !== undefined) return
    const first = messages.find(message => message.role === 'user' && (message.seq ?? -1) > (meta.boundarySeq ?? -1))
    if (first) extras.onSubmitText(first.text)
  }, [messages, meta.topic, meta.boundarySeq, extras])
  useEffect(() => {
    if (!meta.pendingDraft || phase !== 'chat' || !composer.machine) return
    composer.appendDraft(meta.pendingDraft)
    updateTabMeta(ctx, scope.sessionId, tab.id, clearPendingDraft)
    requestAnimationFrame(() => { if (rootRef.current) focusSideComposer(rootRef.current) })
  }, [meta.pendingDraft, phase, composer.machine, ctx, scope.sessionId, tab.id])
  const live = useRef({ composer, meta: tab.meta, phase, title: tab.title, childId, error: forkError ?? undefined, requestId: props.quoteRequestId })
  live.current = { composer, meta: tab.meta, phase, title: tab.title, childId, error: forkError ?? undefined, requestId: props.quoteRequestId }
  useEffect(() => { notifyLiveSideChats() }, [phase, childId, forkError, props.quoteRequestId])
  useEffect(() => { if (childId) dropClosedSideChat(scope.sessionId, childId) }, [childId, scope.sessionId])
  useEffect(() => {
    const dispose = registerLiveSideChat(scope.sessionId, tab.id, text => {
      if (live.current.phase !== 'chat' || !live.current.composer.machine) {
        updateTabMeta(ctx, scope.sessionId, tab.id, current => ({ ...current, pendingDraft: appendDraftText(current.pendingDraft ?? '', text) }))
      } else {
        live.current.composer.appendDraft(text)
        requestAnimationFrame(() => { if (rootRef.current) focusSideComposer(rootRef.current) })
      }
    }, () => live.current.meta, () => live.current.title, () => ({ phase: live.current.phase, childId: live.current.childId, error: live.current.error, requestId: live.current.requestId }))
    const remember = (): void => {
      const current = parseSideChatMeta(live.current.meta)
      if (!current.childId || !current.parentSessionId) return
      recordClosedSideChat(current.parentSessionId, { childId: current.childId, parentSessionId: current.parentSessionId, title: live.current.title, tabId: tab.id,
        savedMeta: { ...current, number: (live.current.meta as { number?: number } | null)?.number }, ...(current.topic ? { topic: current.topic } : {}), closedAt: Date.now() })
    }
    window.addEventListener('pagehide', remember)
    return () => { dispose(); window.removeEventListener('pagehide', remember); remember() }
  }, [ctx, scope.sessionId, tab.id])
  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (rootRef.current?.contains(document.activeElement)) focusMainComposer(document.body)
      else if (rootRef.current) focusSideComposer(rootRef.current)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [visible])
  const parent = meta.parentSessionId ? ctx.sessions.binding(meta.parentSessionId)?.session : undefined
  const parentSnapshot = useSyncExternalStore(useCallback(notify => parent?.subscribe(notify) ?? NOOP_UNSUBSCRIBE, [parent]), () => parent?.getSnapshot() ?? null)
  const status = sessionStatusSource(ctx)
  const parentPending = useSyncExternalStore(useCallback(notify => status?.subscribe(notify) ?? NOOP_UNSUBSCRIBE, [status]), () => status?.getSnapshot().get(meta.parentSessionId ?? scope.sessionId)?.pendingInteraction != null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const promote = async (): Promise<void> => {
    if (!childId || saving) return
    setSaving(true); setSaveError(undefined)
    try { await saveSideChatSession(ctx, childId, tab.id, scope.sessionId, props.annotations); showToast(t('promoteDone')) }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  useSyncExternalStore(props.reflow.subscribe, props.reflow.getSnapshot)
  useSyncExternalStore(props.annotations.subscribe, props.annotations.getSnapshot)
  if (phase === 'fork-error') return <StateScreen title={t('forkErrorTitle')} detail={forkError ?? undefined} hint={t('forkErrorHint')} />
  if (phase === 'missing') return <StateScreen title={t('missingTitle')} detail={t('missingDetail')} hint={t('missingHint')} />
  if (phase !== 'chat' || !reference || !childId) return <StateScreen title={t('preparing')} />
  const side: SideConversation = { sessionId: childId, parentSessionId: meta.parentSessionId ?? scope.sessionId, title: tab.title, boundarySeq: meta.boundarySeq, reflow: props.reflow }
  const replies = finalReplies(messages, meta.boundarySeq, new Set(chat?.getCompletedReplySeqs?.() ?? []))
  const questions = pairQuestions(messages)
  const allAdded = replies.length > 0 && replies.every(reply => isReplyAdded(side, reply, questions.get(reply.key)))
  const running = snapshot?.running === true
  const hasDraft = composer.hasDraft || props.annotations.countActive(childId) > 0
  return <div ref={rootRef} className={css.root} data-sidenote-chat-session={childId} data-sidenote-view-title={tab.title}>
    <div className={css.nativeToolbar}>
      <button type="button" className={css.nativeAction} onClick={() => { openSession(ctx, side.parentSessionId) }}>{t(parentPending ? 'parentPending' : parentSnapshot?.running ? 'parentRunning' : 'parentIdle')}</button>
      <span className={css.nativeToolbarActions}>
        <button type="button" className={css.nativeAction} disabled={running || replies.length === 0 || allAdded} aria-pressed={allAdded} onClick={() => { for (const reply of replies) addReply(side, reply, questions.get(reply.key)) }}>{t(allAdded ? 'reflowAllDone' : 'reflowAll')}</button>
        <button type="button" className={css.nativeAction} disabled={running || composer.pending || hasDraft || saving} title={t(running || composer.pending ? 'promoteBusy' : hasDraft ? 'promoteDraftBusy' : 'promoteTitle')} onClick={() => { void promote() }}>{t('promote')}</button>
      </span>
    </div>
    {saveError && <div className={css.errorRow} role="alert">{saveError}</div>}
    <div className={css.nativeConversation} data-sidenote-transcript>{props.renderConversation(reference, side)}</div>
  </div>
}
