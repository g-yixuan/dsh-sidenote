import type { Context, ConversationService, SessionInput } from './contracts.ts'

export type CapabilityState = 'available' | 'unready' | 'unknown' | 'unavailable'
export type InputReason = 'ready' | 'waitSession' | 'waitService' | 'waitInput' | 'unsupported' | 'readFailed'
export interface InputProbe { state: CapabilityState; reason: InputReason; path: string; input?: SessionInput }

/** One resolver for both composers; scope fixes the recipient before any async work. */
export function resolveInput(ctx: Context, sessionId: string): SessionInput | undefined {
  return probeInput(ctx, sessionId).input
}

/** Shape and real state read share the exact resolver used by both composers. */
export function probeInput(ctx: Context, sessionId: string): InputProbe {
  const path = 'sessions.scope → conversation.input.for'
  try {
    if (sessionId === '') return { state: 'unready', reason: 'waitSession', path }
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) return { state: 'unready', reason: 'waitSession', path }
    const service = ctx.get('conversation') as ConversationService | undefined
    if (service == null) return { state: 'unready', reason: 'waitService', path }
    if (typeof service.input?.for !== 'function') return { state: 'unavailable', reason: 'unsupported', path }
    const input = service?.input.for(scope)
    if (input === undefined || input === null) return { state: 'unready', reason: 'waitInput', path }
    if (typeof input?.setDraft !== 'function' || typeof input.submit !== 'function'
      || typeof input.state?.getSnapshot !== 'function' || typeof input.state.subscribe !== 'function') return { state: 'unavailable', reason: 'unsupported', path }
    if (typeof input.state.getSnapshot()?.draft !== 'string') return { state: 'unavailable', reason: 'unsupported', path }
    return { state: 'available', reason: 'ready', path, input }
  } catch {
    return { state: 'unknown', reason: 'readFailed', path }
  }
}

export function readInputDraft(input: SessionInput): string {
  const draft = input.state.getSnapshot().draft
  return typeof draft === 'string' ? draft : ''
}

export function inputAttachmentIds(input: SessionInput): readonly string[] {
  const state = input.state.getSnapshot()
  return state.attachmentIds ?? state.imageIds ?? []
}

export function addInputAttachments(input: SessionInput, ids: readonly string[]): boolean {
  if (typeof input.addAttachments === 'function') return input.addAttachments(ids)
  return input.addImages?.(ids) ?? false
}

export function removeInputAttachment(input: SessionInput, id: string): void {
  if (typeof input.removeAttachment === 'function') { input.removeAttachment(id); return }
  input.removeImage?.(id)
}

/** setDraft on Lexical hosts rebuilds plain paragraphs and loses reference nodes.
 * The scoped insertText application verb keeps those nodes and uses revision CAS. */
export function prependInputText(input: SessionInput, prefix: string): boolean {
  if (prefix === '') return true
  const state = input.state.getSnapshot()
  const draft = state.draft
  if (state.phase !== 'plain') return false
  if (typeof input.insertText === 'function' && typeof state.draftRev === 'number') {
    const applied = input.insertText(prefix, { start: 0, end: 0, draftRev: state.draftRev })
    return applied && readInputDraft(input) === prefix + draft
  }
  // Only a plain draft can safely use the old facade's replacement verb.
  if ((state.occurrences?.length ?? 0) > 0) return false
  input.setDraft(prefix + draft)
  return readInputDraft(input) === prefix + draft
}

/** Remove only this transaction's prefix; never overwrite subsequent user text. */
export function stripInputPrefix(input: SessionInput, prefix: string): boolean {
  if (prefix === '') return true
  const state = input.state.getSnapshot()
  if (!state.draft.startsWith(prefix) || state.phase !== 'plain') return false
  if (typeof input.insertText === 'function' && typeof state.draftRev === 'number') {
    return input.insertText('', { start: 0, end: prefix.length, draftRev: state.draftRev })
  }
  if ((state.occurrences?.length ?? 0) > 0) return false
  input.setDraft(state.draft.slice(prefix.length))
  return true
}

const pendingRollbacks = new WeakMap<SessionInput, () => void>()
export function cancelInputRollback(input: SessionInput): void { pendingRollbacks.get(input)?.() }

/** Detached native sends can restore their draft after promptError is published.
 * Watch that restoration once; a retry cancels this watch before adding its prefix. */
export function rollbackInputPrefix(input: SessionInput, prefix: string): void {
  if (prefix === '') return
  cancelInputRollback(input)
  let unsubscribe = (): void => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const dispose = (): void => {
    unsubscribe()
    if (timer !== undefined) clearTimeout(timer)
    if (pendingRollbacks.get(input) === dispose) pendingRollbacks.delete(input)
  }
  const check = (): void => { if (stripInputPrefix(input, prefix)) dispose() }
  pendingRollbacks.set(input, dispose)
  unsubscribe = input.state.subscribe(check)
  timer = setTimeout(dispose, 15_000)
  check()
}
