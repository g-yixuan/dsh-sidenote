import type { Context, SessionInput } from '../host/contracts.ts'
import { prependInputText, rollbackInputPrefix, cancelInputRollback } from '../host/input.ts'
import { prepareSubmission } from '../host/submission.ts'
import type { Annotation, AnnotationStore } from './model.ts'
import { buildProtocolBlock } from './format.ts'
import { resolveInput, inputAttachmentIds } from '../host/input.ts'
import { buildReflowBlock, tryInjectReflows, type ReflowStore } from '../reflow.ts'
import { submissionExtrasOf } from './submissionExtras.ts'
import { t } from '../locales.ts'

/** Main and side composers use this same native transaction and acceptance boundary. */
export async function submitAnnotations(options: {
  ctx: Context
  store: AnnotationStore
  sessionId: string
  input: SessionInput
  annotations: readonly Annotation[]
  leadingBlocks?: readonly string[]
  mode?: 'queue' | 'steer'
}): Promise<boolean> {
  const { ctx, store, sessionId, input, annotations } = options
  cancelInputRollback(input)
  const parts = [...(options.leadingBlocks ?? [])]
  if (annotations.length > 0) parts.push(buildProtocolBlock(annotations))
  const block = parts.join('\n\n')
  if (block === '') return false
  const draftBeforeWait = input.state.getSnapshot()
  let prefix = ''
  let receipt: Awaited<ReturnType<typeof prepareSubmission>> | undefined
  try {
    receipt = await prepareSubmission(ctx, sessionId, input, block)
    const draft = input.state.getSnapshot()
    if (draft.draft !== draftBeforeWait.draft || draft.draftRev !== draftBeforeWait.draftRev) {
      throw new Error('等待会话就绪期间草稿已改变；正文和注释已保留，请重新发送')
    }
    prefix = block + (draft.draft === '' ? '' : '\n\n')
    if (!prependInputText(input, prefix)) throw new Error('宿主输入尚未就绪，无法安全加入引用；内容已保留')
    receipt.submit(options.mode)
    await receipt.outcome
    // Edits/new quotes made while admission was in flight remain active.
    store.markSent(annotations.filter(annotation => store.get(annotation.id) === annotation).map(annotation => annotation.id))
    return true
  } catch (error) {
    rollbackInputPrefix(input, prefix)
    const text = error instanceof Error ? error.message : String(error)
    store.setSubmission(sessionId, { pending: false, error: text })
    // The shared chip already exposes this failure; a cosmetic host notice
    // must not reject the completion promise or lose the retained batch.
    try { if (typeof input.notify === 'function') input.notify('error', text) } catch { /* Shared error remains visible. */ }
    return false
  } finally { receipt?.dispose() }
}

/** Shared by native input gestures and the explicit annotation/reflow actions. */
export async function submitControlledInput(ctx: Context, store: AnnotationStore, reflow: ReflowStore, sessionId: string, mode?: 'queue' | 'steer'): Promise<boolean> {
  if (store.getSubmission(sessionId).pending) return false
  const input = resolveInput(ctx, sessionId)
  if (!input) { store.setSubmission(sessionId, { pending: false, error: t('inputUnavailable') }); return false }
  const draft = input.state.getSnapshot()
  if (draft.phase !== 'plain' || draft.draft.trimStart().startsWith('/')) return false
  const active = store.listActive(sessionId)
  const reflows = reflow.list(sessionId)
  if (draft.draft.trim() === '' && inputAttachmentIds(input).length === 0 && active.length === 0 && reflows.length === 0) return false
  const extras = submissionExtrasOf(sessionId)
  const prefix = extras?.firstSendPrefix()
  store.setSubmission(sessionId, { pending: true })
  try {
    const { injectedIds } = await tryInjectReflows(sessionId, reflows)
    for (const id of injectedIds) reflow.remove(id)
    const hitchhikers = reflows.filter(item => !injectedIds.has(item.id))
    if (active.length === 0 && hitchhikers.length === 0 && !prefix) {
      if (input.state.getSnapshot().draft.trim() !== '' || inputAttachmentIds(input).length > 0) input.submit(mode)
      return true
    }
    const accepted = await submitAnnotations({ ctx, store, sessionId, input, annotations: active, leadingBlocks: [...(prefix ? [prefix] : []), ...hitchhikers.map(buildReflowBlock)], mode })
    if (accepted) {
      for (const item of hitchhikers) reflow.remove(item.id)
      extras?.onSubmitText(draft.draft)
      extras?.onAccepted()
    }
    return accepted
  } catch (error) {
    store.setSubmission(sessionId, { pending: false, error: error instanceof Error ? error.message : String(error) })
    return false
  } finally {
    store.setSubmission(sessionId, { ...store.getSubmission(sessionId), pending: false })
  }
}
