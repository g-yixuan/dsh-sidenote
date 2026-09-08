/**
 * sidechat/pending.ts 单测：双版本探测链 + 视图模型归一 + payload 编码 +
 * 缓存稳定性（uSES 纪律）+ 降级路径。
 */
import { describe, expect, it, vi } from 'vitest'
import { createPendingStore } from '../src/client/sidechat/pending.ts'

/** 0.1.1 PendingWait 桩。 */
function waitStub(kind: string, payload: Record<string, unknown>) {
  const respond = vi.fn(async () => ({ accepted: true }))
  return { kind, key: `k-${kind}`, sessionId: 'child-1', payload, respond }
}

function session011(pending: unknown[]) {
  const snap = { pending, nodes: [] }
  return { subscribe: () => () => {}, getSnapshot: () => snap }
}

describe('createPendingStore', () => {
  it('0.1.1 面：审批项适配 + respond 编码（sessionId/approvalId/outcome）', async () => {
    const w = waitStub('approval', { approvalId: 'ap-9', toolName: 'bash', reason: '写工作区外' })
    const store = createPendingStore({}, session011([w]) as never, 'child-1')
    expect(store?.available).toBe(true)
    const items = store!.getSnapshot()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'approval', toolName: 'bash', reason: '写工作区外' })
    await (items[0] as { answer: (o: string) => Promise<void> }).answer('allowed-once')
    expect(w.respond).toHaveBeenCalledWith({ ok: true, value: { sessionId: 'child-1', approvalId: 'ap-9', outcome: 'allowed-once' } })
  })

  it('0.1.1 面：提问整批答复 + 取消编码', async () => {
    const w = waitStub('question', { questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }, 'B'] }] })
    const store = createPendingStore({}, session011([w]) as never, 'child-1')
    const items = store!.getSnapshot()
    expect(items[0]).toMatchObject({ kind: 'question', planReview: false })
    const q = items[0] as Extract<NonNullable<typeof items[0]>, { kind: 'question' }>
    expect(q.questions[0]!.options.map((o: { label: string }) => o.label)).toEqual(['A', 'B'])
    await q.answer([{ id: 'q1', selected: ['A'] }])
    expect(w.respond).toHaveBeenCalledWith({ ok: true, value: { sessionId: 'child-1', answer: { answers: [{ id: 'q1', selected: ['A'] }] } } })
    await q.cancel()
    expect(w.respond).toHaveBeenCalledWith({ ok: false, error: { code: 'cancelled', message: 'the user closed this question request', details: {} } })
  })

  it('0.1.1 面：receipt.accepted=false → throw（UI 层 catch 回退）', async () => {
    const w = waitStub('approval', { approvalId: 'ap-1', toolName: 'x' })
    w.respond.mockResolvedValue({ accepted: false })
    const store = createPendingStore({}, session011([w]) as never, 'child-1')
    const item = store!.getSnapshot()[0] as { answer: (o: string) => Promise<void> }
    await expect(item.answer('rejected')).rejects.toThrow('not pending')
  })

  it('0.1.2 面优先：uiSession.pendingInteractions（Map）→ 域对象 answer/cancel 直通', async () => {
    const answer = vi.fn(async () => {})
    const cancel = vi.fn(async () => {})
    const pending = { kind: 'question', key: 'q:1', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'X' }] }], answer, cancel }
    const map = new Map([['child-1', pending]])
    const ctx = { get: (k: string) => k === 'uiSession' ? { pendingInteractions: { subscribe: () => () => {}, getSnapshot: () => map } } : undefined }
    // 0.1.1 面也在场（pending 数组）——0.1.2 必须优先
    const store = createPendingStore(ctx, session011([waitStub('approval', { approvalId: 'a', toolName: 't' })]) as never, 'child-1')
    const items = store!.getSnapshot()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'question' })
    const q = items[0] as Extract<NonNullable<typeof items[0]>, { kind: 'question' }>
    await q.answer([{ id: 'q1', selected: ['X'] }])
    expect(answer).toHaveBeenCalledWith({ answers: [{ id: 'q1', selected: ['X'] }] })
    await q.cancel()
    expect(cancel).toHaveBeenCalled()
  })

  it('0.1.2 面：审批域对象（无 payload 层，字段平铺）', async () => {
    const answer = vi.fn(async () => {})
    const map = new Map([['child-1', { kind: 'approval', key: 'approval:1', toolName: 'edit', reason: 'r', answer }]])
    const ctx = { get: () => ({ pendingInteractions: { subscribe: () => () => {}, getSnapshot: () => map } }) }
    const store = createPendingStore(ctx, undefined, 'child-1')
    const item = store!.getSnapshot()[0] as { kind: string; toolName: string; answer: (o: string) => Promise<void> }
    expect(item).toMatchObject({ kind: 'approval', toolName: 'edit' })
    await item.answer('rejected')
    expect(answer).toHaveBeenCalledWith('rejected')
  })

  it('缓存稳定：底层引用不变 → getSnapshot 返回同一数组（uSES 纪律）', () => {
    const w = waitStub('approval', { approvalId: 'ap-1', toolName: 'x' })
    const store = createPendingStore({}, session011([w]) as never, 'child-1')
    expect(store!.getSnapshot()).toBe(store!.getSnapshot())
  })

  it('降级：双面缺席 → undefined；快照 pending 非数组 → undefined；未知 kind 项被跳过', () => {
    expect(createPendingStore({}, undefined, 'c')).toBeUndefined()
    expect(createPendingStore({}, { subscribe: () => () => {}, getSnapshot: () => ({}) } as never, 'c')).toBeUndefined()
    const store = createPendingStore({}, session011([{ kind: 'mystery' }]) as never, 'c')
    expect(store!.getSnapshot()).toEqual([])
  })

  it('plan-review 归一为 question + planReview 标记', () => {
    const map = new Map([['c', { kind: 'plan-review', key: 'p:1', questions: [{ id: 'q', question: '批准计划？', options: [{ label: '批准' }] }], answer: async () => {}, cancel: async () => {} }]])
    const ctx = { get: () => ({ pendingInteractions: { subscribe: () => () => {}, getSnapshot: () => map } }) }
    const store = createPendingStore(ctx, undefined, 'c')
    expect(store!.getSnapshot()[0]).toMatchObject({ kind: 'question', planReview: true })
  })
})
