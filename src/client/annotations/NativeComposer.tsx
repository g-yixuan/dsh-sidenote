import { createElement, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import type { Context, InputStateSnapshot } from '../host/contracts.ts'
import { inputAttachmentIds, resolveInput } from '../host/input.ts'
import { findSendButtonInCard } from '../host/dom.ts'
import type { AnnotationStore } from './model.ts'
import type { ReflowStore } from '../reflow.ts'
import { submissionExtrasOf } from './submissionExtras.ts'
import { submitControlledInput } from './send.ts'
import { t } from '../locales.ts'
import css from './annotations.module.css'

type Submit = (mode?: 'queue' | 'steer', source?: 'click' | 'enter') => void
interface Keyboard { submit: Submit }
interface Session { running: boolean; removed?: boolean; subagent?: { address: { mode: string }; parentAvailable?: boolean } }
interface ComposerProps {
  sessionId?: string
  keyboard?: Keyboard
  inputActions?: unknown
  disabled?: boolean
  blocked?: unknown
  variant: string
  useInput<T>(select: (state: InputStateSnapshot | undefined) => T): T
  useSession<T>(select: (state: Session | undefined) => T): T
  useBusyEnter<T>(select: (mode: 'queue' | 'steer') => T): T
  t(key: string): string
}

/** The host has already resolved Enter/click, menus, IME and busy delivery mode. */
export function submitNativeWithContext(ctx: Context, annotations: AnnotationStore, reflow: ReflowStore, sessionId: string, native: Submit, mode?: 'queue' | 'steer', source?: 'click' | 'enter'): void {
  if (annotations.getSubmission(sessionId).pending) return
  const hasContext = annotations.countActive(sessionId) > 0 || reflow.list(sessionId).length > 0
  const input = resolveInput(ctx, sessionId)
  if (!input) {
    if (hasContext || submissionExtrasOf(sessionId)?.firstSendPrefix()) annotations.setSubmission(sessionId, { pending: false, error: t('inputUnavailable') })
    else native(mode, source)
    return
  }
  const draft = input.state.getSnapshot()
  if (draft.phase !== 'plain' || draft.draft.trimStart().startsWith('/')) { native(mode, source); return }
  const hasMessage = draft.draft.trim() !== '' || inputAttachmentIds(input).length > 0
  if (hasContext || hasMessage && submissionExtrasOf(sessionId)?.firstSendPrefix()) {
    void submitControlledInput(ctx, annotations, reflow, sessionId, mode)
  } else native(mode, source)
}

function ContextComposer({ Original, props, ctx, annotations, reflow }: { Original: ComponentType<ComposerProps>; props: ComposerProps; ctx: Context; annotations: AnnotationStore; reflow: ReflowStore }) {
  useSyncExternalStore(annotations.subscribe, annotations.getSnapshot)
  useSyncExternalStore(reflow.subscribe, reflow.getSnapshot)
  const input = props.useInput(state => state)
  const session = props.useSession(state => state)
  const busyMode = props.useBusyEnter(mode => mode)
  const sessionId = props.sessionId ?? ''
  const pending = annotations.getSubmission(sessionId).pending
  const hasContext = annotations.countActive(sessionId) > 0 || reflow.list(sessionId).length > 0
  const contextOnly = hasContext && input?.draft.trim() === '' && (input.attachmentIds ?? input.imageIds ?? []).length === 0
  const root = useRef<HTMLDivElement>(null)
  const [seat] = useState(() => document.createElement('span'))
  const [nativeButton, setNativeButton] = useState<HTMLButtonElement | null>(null)
  const keyboard = useMemo(() => props.keyboard && new Proxy(props.keyboard, {
    get(target, property) {
      if (property === 'submit') return (mode?: 'queue' | 'steer', source?: 'click' | 'enter') => submitNativeWithContext(ctx, annotations, reflow, sessionId, target.submit.bind(target), mode, source)
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }), [props.keyboard, ctx, annotations, reflow, sessionId])
  const useInput = useCallback(<T,>(select: (state: InputStateSnapshot | undefined) => T): T => props.useInput(state => select(pending && state?.phase === 'plain' ? { ...state, phase: 'submitting' } : state)), [props.useInput, pending])
  useLayoutEffect(() => {
    if (!contextOnly || !root.current) return
    const button = findSendButtonInCard(root.current)
    if (!button) return
    setNativeButton(button)
    seat.style.display = 'contents'
    button.parentElement!.append(seat)
    if (!session?.running) button.dataset.sidenoteContextReplaced = ''
    return () => { delete button.dataset.sidenoteContextReplaced; seat.remove() }
  }, [contextOnly, session?.running, sessionId, props.variant, seat])
  const offline = session?.subagent?.address.mode === 'continuable' && session.subagent.parentAvailable !== true
  const disabled = pending || input?.phase !== 'plain' || props.disabled || props.blocked !== undefined || session?.removed || offline || !keyboard || !props.inputActions
  const mode = session?.running ? busyMode : undefined
  const label = props.t(session?.running ? mode === 'steer' ? 'input.send.steer' : 'input.send.queue' : 'input.send')
  return <div className={css.userContextHost} ref={root}>
    {createElement(Original, { ...props, keyboard, useInput })}
    {contextOnly && nativeButton && createPortal(<button type="button" data-sidenote-submit className={nativeButton.className} disabled={disabled} aria-label={label} title={label} onClick={() => { keyboard?.submit(mode, 'click') }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
    </button>, seat)}
  </div>
}

/** Keep the native editor and controls; replace only its empty submit seat
 * while plugin-owned context exists, and retain a separate native Stop. */
export function registerNativeComposer(ctx: Context, annotations: AnnotationStore, reflow: ReflowStore): void {
  type Entry = { component: ComponentType<ComposerProps> }
  const slots = ctx.slots as Context['slots'] & { entries(name: string): readonly Entry[]; subscribe(name: string, notify: () => void): () => void }
  ctx.slots.inject('conversation.composer.bar', () => {
    const patched = new Map<Entry, { original: ComponentType<ComposerProps>; wrapped: ComponentType<ComposerProps> }>()
    const patch = (): void => {
      for (const entry of slots.entries('conversation.composer.bar')) {
        if (patched.has(entry)) continue
        const Original = entry.component
        const Wrapped = (props: ComposerProps) => <ContextComposer Original={Original} props={props} ctx={ctx} annotations={annotations} reflow={reflow} />
        entry.component = Wrapped
        patched.set(entry, { original: Original, wrapped: Wrapped })
      }
    }
    patch()
    const off = slots.subscribe('conversation.composer.bar', patch)
    return () => { off(); for (const [entry, value] of patched) if (entry.component === value.wrapped) entry.component = value.original }
  })
}
