/**
 * 宿主半包 /sidenote/reflow 路由的单测（WI-06，审查 M-3）：
 * trust fence（Host/Origin/sec-fetch-site）、method 收口、payload 校验、
 * agents 探测降级、inject 调用形态（plugin-source + form:notice + summary）。
 */
import { describe, expect, it, vi } from 'vitest'
import { makeReflowHandler } from '../src/index.ts'

function fakeReq(payload: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(payload)
  return {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { yield body },
  }
}

function fakeRes() {
  const calls: { status?: number, body?: string } = {}
  return {
    calls,
    writeHead(status: number) { calls.status = status },
    end(body?: string) { calls.body = body },
  }
}

function fakeCtx(agent: { inject: ReturnType<typeof vi.fn> } | undefined) {
  return {
    get: (name: string) => {
      if (name === 'webRuntime') return { trustedHosts: [] }
      if (name === 'agents') return { get: () => agent }
      return undefined
    },
  }
}

describe('POST /sidenote/reflow（宿主 handler）', () => {
  it('fence：Host 非 loopback → 403；Origin 跨站 → 403', async () => {
    const agent = { inject: vi.fn() }
    const handler = makeReflowHandler(fakeCtx(agent) as never)
    const evilHost = fakeRes()
    await handler(fakeReq({ parentSessionId: 's1', items: [{ text: 'x' }] }, { host: 'evil.example' }) as never, evilHost as never)
    expect(evilHost.calls.status).toBe(403)
    const crossSite = fakeRes()
    await handler(fakeReq({ parentSessionId: 's1', items: [{ text: 'x' }] }, { 'sec-fetch-site': 'cross-site' }) as never, crossSite as never)
    expect(crossSite.calls.status).toBe(403)
    expect(agent.inject).not.toHaveBeenCalled()
  })

  it('method 非 POST → 405', async () => {
    const handler = makeReflowHandler(fakeCtx(undefined) as never)
    const res = fakeRes()
    const req = { ...fakeReq({}), method: 'GET' }
    await handler(req as never, res as never)
    expect(res.calls.status).toBe(405)
  })

  it('payload 缺 parentSessionId/items → 400；空 items → 400', async () => {
    const handler = makeReflowHandler(fakeCtx(undefined) as never)
    const r1 = fakeRes()
    await handler(fakeReq({ items: [{ text: 'x' }] }) as never, r1 as never)
    expect(r1.calls.status).toBe(400)
    const r2 = fakeRes()
    await handler(fakeReq({ parentSessionId: 's1', items: [] }) as never, r2 as never)
    expect(r2.calls.status).toBe(400)
  })

  it('父会话无 live agent → 200 ok:false（客户端回落搭车）', async () => {
    const handler = makeReflowHandler(fakeCtx(undefined) as never)
    const res = fakeRes()
    await handler(fakeReq({ parentSessionId: 's1', items: [{ text: 'x', sideTitle: '侧边' }] }) as never, res as never)
    expect(res.calls.status).toBe(200)
    expect(JSON.parse(res.calls.body!)).toEqual({ ok: false, error: 'no-live-agent' })
  })

  it('有 live agent → inject 以 plugin-source + notice 形态调用，ok:true', async () => {
    const agent = { inject: vi.fn() }
    const handler = makeReflowHandler(fakeCtx(agent) as never)
    const res = fakeRes()
    await handler(fakeReq({ parentSessionId: 's1', items: [{ text: '<reflow>结论</reflow>', sideTitle: '侧边 2' }] }) as never, res as never)
    expect(res.calls.status).toBe(200)
    expect(JSON.parse(res.calls.body!)).toEqual({ ok: true })
    expect(agent.inject).toHaveBeenCalledTimes(1)
    const message = agent.inject.mock.calls[0]![0] as { content: { text: string }[], source: { kind: string, plugin: string, form: string, summary: string } }
    expect(message.content[0]!.text).toContain('<reflow>结论</reflow>')
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'dsh-sidenote', form: 'notice' })
    expect(message.source.summary).toContain('侧边 2')
  })
})
