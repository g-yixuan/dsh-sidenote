import type { ObservableSnapshot } from './contracts.ts'

/** Host configuration fields needed for the one-time reply preference. */
export interface ReplyDefaultsForm<T> extends ObservableSnapshot<{
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  writable: boolean
  revision: number | undefined
}> {
  mutate(ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[], expectedRevision: number): Promise<boolean>
}

export function initializeFinalReplies(
  sidenote: ReplyDefaultsForm<{ finalRepliesDefaultAttempted?: boolean }>,
  chat: ReplyDefaultsForm<{ foldedReplies: 'all' | 'final' }>,
): () => void {
  let stopped = false
  let attempted = false
  const initialize = (): void => {
    if (stopped || attempted) return
    const own = sidenote.getSnapshot(), target = chat.getSnapshot()
    if (own.status !== 'ready' || target.status !== 'ready' || !own.writable || !target.writable
      || !own.value || !target.value || own.revision === undefined || target.revision === undefined) return
    if (own.value.finalRepliesDefaultAttempted) return
    attempted = true
    // ponytail: 每个 profile 只尝试一次；失败后由用户手动设置，避免重复覆盖。
    void (async () => {
      if (!await sidenote.mutate([{ op: 'set', path: ['finalRepliesDefaultAttempted'], value: true }], own.revision!) || stopped) return
      if (target.value!.foldedReplies !== 'final') {
        await chat.mutate([{ op: 'set', path: ['foldedReplies'], value: 'final' }], target.revision!)
      }
    })().catch(() => { console.warn('[dsh-sidenote] 最终回答显示偏好初始化未完成，保留当前设置。') })
  }
  const unsubscribeOwn = sidenote.subscribe(initialize)
  const unsubscribeChat = chat.subscribe(initialize)
  initialize()
  return () => { stopped = true; unsubscribeOwn(); unsubscribeChat() }
}
