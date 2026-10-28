import type { Context, ObservableSnapshot, RpcResult, SessionBinding, SessionInput } from './contracts.ts'
import { chatSourceOf, retainSession } from './chat.ts'

interface Message { seq?: number; id?: string; messageId?: string; kind?: string; content?: unknown }
interface Inbox { 'next-turn'?: readonly Message[]; 'next-step'?: readonly Message[] }
const confirmedSessions = new WeakSet<object>()

/** Only an actual observed admission confirms this session generation. */
export function hasConfirmedAcceptance(binding: SessionBinding | undefined): boolean {
  return binding !== undefined && confirmedSessions.has(binding.session)
}

function inboxFaceOf(binding: SessionBinding): ObservableSnapshot<Inbox | undefined> | undefined {
  const session = binding.session as typeof binding.session & {
    projections?: { faceOf(key: string): ObservableSnapshot<Inbox | undefined> }
  }
  return session.projections?.faceOf('inbox')
}

/** Old hosts publish authoritative queue rows on Session, newer ones publish Inbox. */
function queuedMessages(binding: SessionBinding, inbox: ObservableSnapshot<Inbox | undefined> | undefined): readonly Message[] {
  const queue = binding.session.getSnapshot().queue
  if (Array.isArray(queue)) return queue as Message[]
  if (inbox !== undefined) {
    const state = inbox.getSnapshot()
    return [...(state?.['next-turn'] ?? []), ...(state?.['next-step'] ?? [])]
  }
  return []
}

/** Only call before publishing a newly forked child. Pending Inbox occurrences
 * belong to the parent task; remove the copies before accepting any side input.
 * Never cancel a turn or remove/replay messages from an already usable child. */
export async function clearForkQueue(binding: SessionBinding): Promise<void> {
  const items = queuedMessages(binding, inboxFaceOf(binding))
  const session = binding.session as typeof binding.session & { updateQueue?: (id: string, action: { kind: 'remove' }) => Promise<RpcResult<unknown>> }
  for (const item of items) {
    const id = item.id ?? item.messageId
    if (!id || !session.updateQueue) throw new Error('无法隔离侧聊继承的主线队列')
    const result = await session.updateQueue(id, { kind: 'remove' })
    if (!result.ok) throw new Error(result.error.message ?? '清理侧聊队列副本失败')
  }
}

export interface SubmissionReceipt {
  readonly outcome: Promise<void>
  /** Subscribe first, then invoke exactly one native submit. */
  submit(mode?: 'queue' | 'steer'): void
  dispose(): void
}

/** Observe real target admission, never an empty draft or pendingSubmissions echo.
 * The baseline excludes earlier identical quotes and fork-inherited history. */
export async function prepareSubmission(ctx: Context, sessionId: string, input: SessionInput, needle: string): Promise<SubmissionReceipt> {
  const retained = retainSession(ctx, sessionId)
  let binding: SessionBinding | undefined
  try {
    binding = retained === undefined ? ctx.sessions.binding(sessionId) : await retained.ready
    if (binding === undefined) throw new Error('目标会话尚未就绪')
    // Old public concrete Session.open waits for initial durable history.
    if (retained === undefined) {
      const session = binding.session as typeof binding.session & { open?: () => Promise<void> }
      if (typeof session.open === 'function') await session.open()
    }
    const chat = chatSourceOf(ctx, binding)
    if (chat === undefined || chat.getLegacy() === null) throw new Error('宿主消息确认能力尚未就绪；注释已保留')
    const inbox = inboxFaceOf(binding)
    const nodes = (): readonly Message[] => chat.getLegacy()?.nodes as readonly Message[] ?? []
    const maxSeq = Math.max(-1, ...nodes().map(node => node.seq ?? -1))
    const queueIds = new Set(queuedMessages(binding, inbox).map(message => message.messageId ?? message.id))
    const previousError = binding.session.getSnapshot().promptError
    const previousNoticeSeq = input.notices?.getSnapshot()?.seq ?? -1
    const off: (() => void)[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let submitted = false
    let settled = false
    let disposed = false
    let resolve!: () => void
    let reject!: (error: Error) => void
    const outcome = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      for (const unsubscribe of off.splice(0)) unsubscribe()
      retained?.release()
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      dispose()
      if (error === undefined) { confirmedSessions.add(binding!.session); resolve() }
      else reject(error)
    }
    const matches = (message: Message): boolean => {
      // Native attachment blocks precede text. Their UI '[Image]' preview is
      // not prompt text and cannot participate in the protocol-prefix match.
      const content = message.content
      const text = Array.isArray(content) ? content
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string).join('\n') : ''
      return text.trimStart().startsWith(needle.trimStart())
    }
    const check = (): void => {
      if (!submitted || settled) return
      if (nodes().some(node => (node.kind === 'user' || node.kind === 'steering') && (node.seq ?? -1) > maxSeq && matches(node))
        || queuedMessages(binding!, inbox).some(message => {
          const id = message.messageId ?? message.id
          return id !== undefined && !queueIds.has(id) && matches(message)
        })) { finish(); return }
      const state = binding!.session.getSnapshot()
      const error = state.promptError as { op?: string; error?: { message?: string } } | null | undefined
      if (error !== previousError && error?.op === 'send') {
        finish(new Error(error.error?.message ?? '消息提交失败；注释已保留'))
        return
      }
      const notice = input.notices?.getSnapshot()
      if (notice?.level === 'error' && notice.seq > previousNoticeSeq) { finish(new Error(notice.text)); return }
      if (state.removed === true || state.openState === 'error') finish(new Error('目标会话已不可用；注释已保留'))
    }
    off.push(chat.subscribe(check), binding.session.subscribe(check))
    if (inbox !== undefined) off.push(inbox.subscribe(check))
    if (input.notices !== undefined) off.push(input.notices.subscribe(check))
    return {
      outcome,
      dispose,
      submit(mode) {
        if (submitted) return
        submitted = true
        timer = setTimeout(() => finish(new Error('尚未确认消息被宿主接受；请先核对目标会话，注释已保留')), 15_000)
        try { input.submit(mode); check() } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      },
    }
  } catch (error) { retained?.release(); throw error }
}
