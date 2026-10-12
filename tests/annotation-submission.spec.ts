/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import type { Context, SessionInput } from '../src/client/host/contracts.ts'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import { submitAnnotations } from '../src/client/annotations/send.ts'
import { buildProtocolBlock } from '../src/client/annotations/format.ts'
import { resolveAttachmentApis, attachFiles } from '../src/client/host/attachments.ts'

function observable<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    set(next: T) { state = next; for (const fn of [...listeners]) fn() },
  }
}

function harness(modern = false) {
  const store = createAnnotationStore(() => 1, null)
  const quote = store.add({ sessionId: 'child', sourceSessionId: 'parent', sourceSurface: 'main', anchorKey: 'a', text: '完整引用\n第二行', anchorText: '完整引用第二行', occurrence: 0, note: '注解' })
  const wire = buildProtocolBlock([quote])
  const node = { kind: 'user', seq: 1, content: [{ type: 'text', text: wire }] }
  const session = observable({ sessionId: 'child', running: false, nodes: [node], queue: modern ? undefined : [] as unknown[], promptError: null as unknown, pendingSubmissions: [] as unknown[] })
  const inbox = observable({ 'next-turn': [] as unknown[], 'next-step': [] as unknown[] })
  const inputState = observable({ draft: '正文', phase: 'plain' as const })
  const submitted = vi.fn()
  let sentText = ''
  const input = {
    state: inputState,
    setDraft(text: string) { inputState.set({ ...inputState.getSnapshot(), draft: text }) },
    submit(mode?: string) { sentText = inputState.getSnapshot().draft; submitted(mode) },
    notify: vi.fn(),
  } as unknown as SessionInput
  const ctx = {
    sessions: { binding: (id: string) => { expect(id).toBe('child'); return { session: { ...session, projections: { faceOf: () => inbox } } } } },
    get: () => undefined,
  } as unknown as Context
  return { store, quote, wire, session, inbox, input, submitted, ctx, sentText: () => sentText,
    send: () => submitAnnotations({ ctx, store, sessionId: 'child', input, annotations: store.listActive('child') }) }
}

describe('controlled quote admission', () => {
  it('waiting for the target cannot silently submit newly typed body text', async () => {
    const h = harness()
    let ready!: (binding: unknown) => void
    const release = vi.fn()
    const binding = h.ctx.sessions.binding('child')
    const ctx = { ...h.ctx, sessions: { ...h.ctx.sessions, retain: () => ({ ready: new Promise(resolve => { ready = resolve }), release }) } } as unknown as Context
    const result = submitAnnotations({ ctx, store: h.store, sessionId: 'child', input: h.input, annotations: [h.quote] })
    h.input.setDraft('等待期间输入的新正文')
    ready(binding)
    expect(await result).toBe(false)
    expect(h.submitted).not.toHaveBeenCalled()
    expect(h.input.state.getSnapshot().draft).toBe('等待期间输入的新正文')
    expect(h.store.get(h.quote.id)?.state).toBe('active')
    expect(release).toHaveBeenCalledOnce()
  })

  it('optimistic clearing and pending echo do not mark sent; new durable user message does', async () => {
    const h = harness()
    const result = h.send()
    await vi.waitFor(() => expect(h.submitted).toHaveBeenCalledOnce())
    h.input.setDraft('')
    h.session.set({ ...h.session.getSnapshot(), pendingSubmissions: [{ text: h.sentText() }] })
    expect(h.store.get(h.quote.id)?.state).toBe('active')
    // The identical inherited node at seq=1 above cannot acknowledge this batch.
    h.session.set({ ...h.session.getSnapshot(), nodes: [...h.session.getSnapshot().nodes, { kind: 'user', seq: 2, content: [{ type: 'text', text: h.sentText() }] }] })
    expect(await result).toBe(true)
    expect(h.store.get(h.quote.id)?.state).toBe('sent')
  })

  it('a real rejection keeps quotes active and removes only the inserted prefix', async () => {
    const h = harness()
    const result = h.send()
    await vi.waitFor(() => expect(h.submitted).toHaveBeenCalledOnce())
    h.input.setDraft(h.sentText() + '（提交期间追加）')
    h.session.set({ ...h.session.getSnapshot(), promptError: { op: 'send', error: { message: '拒绝入队' } } })
    expect(await result).toBe(false)
    expect(h.input.state.getSnapshot().draft).toBe('正文（提交期间追加）')
    expect(h.store.get(h.quote.id)?.state).toBe('active')
    expect(h.store.getSubmission('child').error).toBe('拒绝入队')
  })

  it('cleans a native draft restored after the rejection notification', async () => {
    const h = harness()
    const result = h.send()
    await vi.waitFor(() => expect(h.submitted).toHaveBeenCalledOnce())
    h.input.setDraft('')
    h.session.set({ ...h.session.getSnapshot(), promptError: { op: 'send', error: { message: '拒绝提交' } } })
    expect(await result).toBe(false)
    // This is the real detached native ordering: its draft restoration follows promptError.
    h.input.setDraft(h.sentText())
    expect(h.input.state.getSnapshot().draft).toBe('正文')
    expect(h.store.get(h.quote.id)?.state).toBe('active')
  })

  it('acknowledges native messages whose image blocks precede the quote protocol', async () => {
    const h = harness()
    const result = h.send()
    await vi.waitFor(() => expect(h.submitted).toHaveBeenCalledOnce())
    h.session.set({ ...h.session.getSnapshot(), nodes: [...h.session.getSnapshot().nodes, { kind: 'user', seq: 2, content: [{ type: 'image', text: '[Image]' }, { type: 'text', text: h.sentText() }] }] })
    expect(await result).toBe(true)
    expect(h.store.get(h.quote.id)?.state).toBe('sent')
  })

  it.each([false, true])('authoritative queue acknowledges without a model reply (modern=%s)', async modern => {
    const h = harness(modern)
    const result = h.send()
    await vi.waitFor(() => expect(h.submitted).toHaveBeenCalledOnce())
    const row = { id: 'fresh-message', messageId: 'fresh-message', content: [{ type: 'text', text: h.sentText() }] }
    if (modern) h.inbox.set({ 'next-turn': [row], 'next-step': [] })
    else h.session.set({ ...h.session.getSnapshot(), queue: [row] })
    expect(await result).toBe(true)
    expect(h.store.get(h.quote.id)?.state).toBe('sent')
  })

  it('new or edited quotes and the next body remain active after the old batch is accepted', async () => {
    const h = harness()
    const result = h.send()
    await vi.waitFor(() => expect(h.submitted).toHaveBeenCalledOnce())
    const extra = h.store.add({ ...h.quote, note: '下一条' })
    h.store.setNote(h.quote.id, '发送期间新修改')
    h.input.setDraft('下一条正文')
    h.session.set({ ...h.session.getSnapshot(), nodes: [...h.session.getSnapshot().nodes, { kind: 'user', seq: 2, content: [{ type: 'text', text: h.sentText() }] }] })
    expect(await result).toBe(true)
    expect(h.store.get(extra.id)?.state).toBe('active')
    expect(h.store.get(h.quote.id)).toMatchObject({ state: 'active', note: '发送期间新修改' })
    expect(h.input.state.getSnapshot().draft).toBe('下一条正文')
  })
})

describe('host image intake', () => {
  it('new attachment service freezes the recipient and releases rejected drafts', () => {
    const createDrafts = vi.fn(() => [{ kind: 'image' as const, id: 'image', previewUrl: 'blob:preview' }])
    const releaseDraftAttachment = vi.fn()
    const apis = resolveAttachmentApis({ get: () => ({ createDrafts, releaseDraftAttachment, resolveDraftAttachments: () => [] }) } as unknown as Context, 'child')!
    const file = new File(['bytes'], 'test.png', { type: 'image/png' })
    const input = { addAttachments: () => false } as unknown as SessionInput
    expect(attachFiles(apis, input, [file])).toBe(false)
    expect(createDrafts).toHaveBeenCalledWith('child', [file])
    expect(releaseDraftAttachment).toHaveBeenCalledWith('image')
  })
})
