/** Programmatic draft handoff only. The embedded native composer owns editing and submission. */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Context, SessionFace, SessionInput } from '../host/contracts.ts'
import { resolveInput, readInputDraft, inputAttachmentIds } from '../host/input.ts'
import { hostDiagnostics } from '../host/probes.ts'
import { appendDraftText } from './model.ts'
export { readInputDraft } from '../host/input.ts'

export function resolveSessionInput(ctx: Context, sessionId: string): SessionInput | null {
  return resolveInput(ctx, sessionId) ?? null
}
export interface Composer { readonly machine: boolean; readonly pending: boolean; readonly hasDraft: boolean; appendDraft(text: string): void }

export function useComposer(ctx: Context, session: SessionFace | undefined, sessionId: string | undefined): Composer {
  const diagnostics = hostDiagnostics(ctx)
  const hostState = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot)
  const input = useMemo(() => sessionId === undefined ? null : resolveSessionInput(ctx, sessionId), [ctx, session, sessionId, hostState])
  const subscribe = useCallback((notify: () => void) => input?.state.subscribe(notify) ?? (() => {}), [input])
  const pending = useSyncExternalStore(subscribe, () => {
    const state = input?.state.getSnapshot()
    return state !== undefined && (state.phase !== 'plain' || (state.queue?.length ?? 0) > 0)
  })
  const hasDraft = useSyncExternalStore(subscribe, () => input !== null && (readInputDraft(input).trim() !== '' || inputAttachmentIds(input).length > 0))
  const appendDraft = useCallback((text: string): void => {
    if (input !== null) input.setDraft(appendDraftText(readInputDraft(input), text))
  }, [input])
  return { machine: input !== null, pending, hasDraft, appendDraft }
}
