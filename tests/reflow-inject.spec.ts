// @vitest-environment jsdom
/**
 * tryInjectReflows（Workitem_06 注入通道客户端面）：成功全量 / 路由缺席
 * 降级 / 无 live agent 降级 / 超时降级 / 注入文本带自然语言引导行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tryInjectReflows, type ReflowItem } from '../src/client/reflow.ts'

const ITEM: ReflowItem = {
  id: 1,
  sessionId: 'p1',
  sideTitle: '侧边',
  text: '结论全文',
  question: '提问',
  createdAt: 1,
}

describe('tryInjectReflows', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('空集直接成功（无网络往返）', async () => {
    const result = await tryInjectReflows('p1', [])
    expect(result.injectedIds.size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('路由 200 + ok:true → 全量注入；payload 带引导行与 sideTitle', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const result = await tryInjectReflows('p1', [ITEM])
    expect([...result.injectedIds]).toEqual([1])
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1]!.body as string))
    expect(body.parentSessionId).toBe('p1')
    expect(body.items).toHaveLength(1)
    expect(body.items[0].text).toContain('以下是用户从侧边对话带回的结论')
    expect(body.items[0].text).toContain('<reflow')
    expect(body.items[0].sideTitle).toBe('侧边')
  })

  it('路由缺席（reject）/ 非 200 / ok:false → 全未注入（调用方搭车兜底）', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('404'))
    expect((await tryInjectReflows('p1', [ITEM])).injectedIds.size).toBe(0)
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x', { status: 500 }))
    expect((await tryInjectReflows('p1', [ITEM])).injectedIds.size).toBe(0)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'no-live-agent' }), { status: 200 }))
    expect((await tryInjectReflows('p1', [ITEM])).injectedIds.size).toBe(0)
  })

  it('超时（300ms）降级：abort 即回落', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
      }))
      const pending = tryInjectReflows('p1', [ITEM])
      await vi.advanceTimersByTimeAsync(400)
      const result = await pending
      expect(result.injectedIds.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
