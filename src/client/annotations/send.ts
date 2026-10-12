import type { Context, SessionInput } from '../host/contracts.ts'
import { prependInputText, rollbackInputPrefix, cancelInputRollback } from '../host/input.ts'
import { prepareSubmission } from '../host/submission.ts'
import type { Annotation, AnnotationStore } from './model.ts'
import { buildProtocolBlock } from './format.ts'

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
