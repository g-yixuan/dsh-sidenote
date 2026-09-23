// @vitest-environment jsdom
/**
 * referenceSource（@引用侧边聊天）的会话作用域护栏（Delivery_05 审查 M2）：
 * - 候选名 → childId 映射按会话分键，跨会话 pick 拒绝；
 * - candidates() 早退路径清空本会话映射，陈旧名字不再可 pick；
 * - 同名候选消歧后按名取到正确 childId。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import { registerSideChatReferenceSource } from '../src/client/sidechat/referenceSource.ts'
import { writeSideChatMeta } from '../src/client/sidechat/metaStore.ts'

interface Candidate { name: string }
interface SourceFace {
  candidates(session: { sessionId?: string }, signal: AbortSignal): Promise<readonly Candidate[]>
  onPick(pick: { candidate: Candidate }, session: { sessionId?: string }): { insert: { ref: string } } | undefined
}

function fakeCtx(): { ctx: Context, source: () => SourceFace } {
  let captured: SourceFace | undefined
  const ctx = {
    // betterSidebar 缺席 → 直连腿；inputTriggers 捕获注册的源。
    get: (name: string) => (name === 'inputTriggers'
      ? { registerSource: (s: SourceFace) => { captured = s; return () => {} } }
      : undefined),
    effect: (fn: () => void) => { fn() },
  } as unknown as Context
  return { ctx, source: () => { if (captured === undefined) throw new Error('source 未注册'); return captured } }
}

function liveMeta(sessionId: string, tabId: string, childId: string, topic?: string): void {
  writeSideChatMeta({
    tabId, sessionId, parentSessionId: sessionId, childId,
    ...(topic !== undefined ? { topic } : {}),
    number: 1, createdAt: 1,
  }, { silent: true })
}

describe('@引用候选的会话作用域（M2）', () => {
  beforeEach(() => localStorage.clear())

  it('同会话 pick 命中；跨会话复用候选名拒绝', async () => {
    const { ctx, source } = fakeCtx()
    registerSideChatReferenceSource(ctx)
    liveMeta('sess-A', 't1', 'child-A', '部署泳道')
    const cands = await source().candidates({ sessionId: 'sess-A' }, new AbortController().signal)
    expect(cands.map(c => c.name)).toEqual(['Side · 部署泳道'])
    // 同会话：正常取到 childId
    expect(source().onPick({ candidate: cands[0]! }, { sessionId: 'sess-A' })?.insert.ref).toBe('child-A')
    // 跨会话：同名候选不得解析（旧全局缓存会把 child-A 插进 sess-B）
    expect(source().onPick({ candidate: cands[0]! }, { sessionId: 'sess-B' })).toBeUndefined()
  })

  it('candidates 早退后陈旧名字不再可 pick', async () => {
    const { ctx, source } = fakeCtx()
    registerSideChatReferenceSource(ctx)
    liveMeta('sess-A', 't1', 'child-A', '部署泳道')
    const cands = await source().candidates({ sessionId: 'sess-A' }, new AbortController().signal)
    // 会话清空（tab 关闭）→ 重新 candidates 得空列表 → 旧名失效
    localStorage.clear()
    await source().candidates({ sessionId: 'sess-A' }, new AbortController().signal)
    expect(source().onPick({ candidate: cands[0]! }, { sessionId: 'sess-A' })).toBeUndefined()
  })

  it('同名候选消歧后按名取到各自 childId', async () => {
    const { ctx, source } = fakeCtx()
    registerSideChatReferenceSource(ctx)
    liveMeta('sess-A', 't1', 'child-1', '部署泳道')
    liveMeta('sess-A', 't2', 'child-2', '部署泳道')
    const cands = await source().candidates({ sessionId: 'sess-A' }, new AbortController().signal)
    expect(cands.map(c => c.name)).toEqual(['Side · 部署泳道', 'Side · 部署泳道 · 2'])
    expect(source().onPick({ candidate: cands[0]! }, { sessionId: 'sess-A' })?.insert.ref).toBe('child-1')
    expect(source().onPick({ candidate: cands[1]! }, { sessionId: 'sess-A' })?.insert.ref).toBe('child-2')
  })
})
