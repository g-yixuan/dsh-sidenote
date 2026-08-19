/**
 * Managed draft prefix (Workitem 02 发送携带的降级方案): while a session has
 * active annotations, their formatted quote block is maintained at the very
 * top of the composer draft; the user's own text follows it, so sending
 * naturally carries the context. The composer chip clears on the send edge
 * (draft non-empty → empty), the annotations flip to 'sent', and the prefix
 * dissolves with the already-cleared draft.
 *
 * insertReference spike conclusion: the U+FFFC chip path is NOT viable from a
 * plugin — `SessionInput.insertReference` requires a span CAS'd against the
 * live draftRev (a trigger-pipeline concept), and chip serialization routes
 * through the source owner's ReferenceCodec, which is package-internal to
 * ui-input-trigger with no plugin-facing registry. An unowned source would
 * mark the occurrence invalid and fail the whole submit. Hence this file.
 */
import type { Context, ConversationService, SessionId, SessionInput } from '../../context-types.ts'
import { buildQuoteBlock, nextManagedDraft } from './format.ts'
import type { AnnotationStore } from './model.ts'

/** The head (quote block + blank line) last written into each session's draft. */
const managedHeads = new Map<SessionId, string>()

/** Resolve the per-session input facade, degrading to undefined (never throws). */
export function resolveInput(ctx: Context, sessionId: SessionId): SessionInput | undefined {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return undefined
    const conversation = ctx.get('conversation') as ConversationService | undefined
    return conversation?.input.for(actx)
  } catch {
    return undefined
  }
}

/**
 * Rewrite one session's draft so its managed head matches the active
 * annotations. A no-op when nothing would change (the common case while the
 * user types their own message below the head).
 */
export function syncSessionDraft(ctx: Context, store: AnnotationStore, sessionId: SessionId): void {
  try {
    const input = resolveInput(ctx, sessionId)
    if (input === undefined) return
    const block = buildQuoteBlock(store.listActive(sessionId))
    const lastHead = managedHeads.get(sessionId) ?? ''
    const draft = input.state.getSnapshot().draft
    const next = nextManagedDraft(draft, lastHead, block)
    // block 为空（注释全部 sent/移除）时不覆写 managedHeads：submit 失败
    // rollback 会把含旧前缀的草稿恢复回来，保留 lastHead 才能让下一次 sync
    // 正常剥离它，否则新注释的前缀会叠在旧前缀之上（双重引用块）。
    if (block !== '') managedHeads.set(sessionId, next.head)
    if (next.draft === draft) return
    input.setDraft(next.draft)
  } catch (error) {
    console.warn('[dsh-sidechat] draft sync failed:', error)
  }
}

/** Re-sync every session holding annotations (store-change fan-out). */
export function syncAllDrafts(ctx: Context, store: AnnotationStore): void {
  for (const sessionId of store.sessions()) syncSessionDraft(ctx, store, sessionId)
}

/** Forget all managed heads (page-level lifecycle; plugin teardown/testing). */
export function resetManagedHeads(): void {
  managedHeads.clear()
}
