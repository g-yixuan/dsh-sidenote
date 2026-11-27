import type { Context, SessionFace } from '../host/contracts.ts'
import { contextEventSource, loadForkBoundary, loadInheritedContext, retainSession, unfinishedCompactionCut } from '../host/chat.ts'
import { resolveInput } from '../host/input.ts'
import { readModelSelection, writeModelSelection } from '../host/models.ts'
import { sessionVisibilityOf } from '../host/sessionVisibility.ts'
import { clearForkQueue } from '../host/submission.ts'
import { rootContext } from '../host/sidebar.ts'
import { hasSideChatSession } from './metaStore.ts'
import { buildMainlineSnapshot } from './snapshot.ts'

/** Never discard child-owned work or command settings to gain a longer prefix. */
export function canRefreshContext(session: SessionFace, boundary: number): boolean {
  const window = contextEventSource(session)?.getSnapshot()
  return !!window && (!window.hasMore || (window.entries[0]?.event.seq ?? Infinity) <= boundary + 1)
    && !session.getSnapshot().running
    && window.entries.every(({ event }) => event.seq <= boundary
      || ['session/end-seed', 'model/selection', 'session/title'].includes(event.type))
}

/** Freeze one observed parent cut before awaiting fork. The host copies original
 * messages, headers, tool history and compactions; only the uncommitted tail is XML. */
export async function prepareCachedContext(ctx: Context, parentId: string, childId: string, boundary: number, signal?: AbortSignal) {
  const checkOpen = (): void => { if (signal?.aborted) throw new Error('侧聊已关闭，正文已保留') }
  checkOpen()
  const child = ctx.sessions.binding(childId)?.session
  if (!child) return undefined
  await loadInheritedContext(child, boundary)
  if (!canRefreshContext(child, boundary)) return undefined
  const sourceSeq = contextEventSource(child)?.getSnapshot().entries.at(-1)?.event.seq
  const assertCurrent = (): void => {
    checkOpen()
    if (ctx.sessions.binding(childId)?.session !== child || !canRefreshContext(child, boundary)
      || contextEventSource(child)?.getSnapshot().entries.at(-1)?.event.seq !== sourceSeq) throw new Error('准备期间侧聊的模型、权限或内容已改变；正文已保留，请重新发送')
  }
  const selection = await readModelSelection(ctx, childId)
  if (!selection) return undefined
  const parent = retainSession(ctx, parentId)
  try {
    const binding = parent ? await parent.ready : ctx.sessions.binding(parentId)
    await loadInheritedContext(binding?.session, boundary)
    const window = contextEventSource(binding?.session)?.getSnapshot()
    // Live stream rows use fractional positions and cannot be native fork cuts.
    const cut = unfinishedCompactionCut(binding?.session) ?? window?.entries.findLast(({ event }) => Number.isSafeInteger(event.seq))?.event.seq
    if (cut === undefined || cut <= boundary || cut < 0) return undefined
    // A new fork must not silently inherit the parent's newer access policy.
    if (window?.entries.some(({ event }) => event.seq > boundary && event.seq <= cut
      && ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(event.type))) return undefined
    if (!window?.entries.some(({ event }) => event.seq > boundary && event.seq <= cut
      && ['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'].includes(event.type))) return undefined
    const text = buildMainlineSnapshot(ctx, parentId, new Date(), cut)
    if (text === null) throw new Error('主线上下文尚未就绪，内容已保留')
    const visibility = sessionVisibilityOf(ctx)
    checkOpen()
    const finish = visibility.begin(ctx.sessions.list.getSnapshot())
    let reference: ReturnType<typeof retainSession>
    let sessionId: string | undefined
    let adopted = false
    const dispose = async (): Promise<void> => {
      try {
        if (!sessionId || adopted || hasSideChatSession(sessionId)) return
        const candidate = ctx.sessions.binding(sessionId)?.session
        await loadInheritedContext(candidate, cut)
        const events = contextEventSource(candidate)?.getSnapshot()
        // A running-parent fork may add synthetic closing events after its cut.
        if (candidate && !candidate.getSnapshot().running && events
          && (!events.hasMore || (events.entries[0]?.event.seq ?? Infinity) <= cut + 1)
          && events.entries.every(({ event }) => event.seq <= cut || ['session/end-seed', 'model/selection', 'session/title', 'tool/result', 'step/end', 'turn/end'].includes(event.type))
          && !hasSideChatSession(sessionId)) await rootContext(ctx).workspaces.archiveSession(sessionId)
      } catch (error) { console.warn('[dsh-sidenote] 归档未交付的侧聊失败:', error) }
      finally { reference?.release(); reference = undefined }
    }
    try {
      sessionId = await ctx.sessions.fork({ sessionId: parentId, atSeq: cut })
      visibility.hide(sessionId)
      reference = retainSession(ctx, sessionId)
      const target = reference ? await reference.ready : ctx.sessions.binding(sessionId)
      if (!target || await loadForkBoundary(target.session) !== cut) throw new Error('侧聊继承边界不一致，内容已保留')
      checkOpen()
      await clearForkQueue(target)
      if (!await writeModelSelection(ctx, sessionId, selection)) throw new Error('无法保留侧聊模型选择，内容已保留')
      const input = resolveInput(ctx, sessionId)
      if (!input) throw new Error('侧聊输入尚未就绪，内容已保留')
      assertCurrent()
      return { text, boundary: cut, sessionId, input, adopt: (activate: () => void) => { assertCurrent(); activate(); adopted = true }, dispose }
    } catch (error) { await dispose(); throw error }
    finally { finish() }
  } finally { parent?.release() }
}
