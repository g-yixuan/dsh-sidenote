/** Legacy reflow endpoint retained for clients already open during an update.
 * New composers send context with the native message in one queue/steer admission.
 * Keep the trust fence and old source identity for those clients and history. */
import type { IncomingHttpHeaders } from 'node:http'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { isTrustedApiRequest } from './trust-fence.ts'
import { contextProjection } from './contextProjection.ts'

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    'dsh-sidenote': {
      readonly kind: 'dsh-sidenote'
      readonly form: 'notice'
      readonly summary: string
    }
  }
}

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-sidenote'

// ── 宿主面镜像（结构性子集；权威：dsh-better-sidebar src/context-types.ts） ────

interface HttpRequestLike {
  headers: IncomingHttpHeaders
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: HttpRequestLike, res: HttpResponseLike) => void | Promise<void>
  }): () => void
}

interface AgentsLike {
  get(id: string): { inject(message: unknown): void } | undefined
}

interface WebRuntimeLike {
  trustedHosts?: readonly string[]
}

interface HostContext {
  get(name: string): unknown
  effect(fn: () => void | (() => void), label?: string): unknown
}

// ── wire 工具（最小集，better-sidebar src/wire.ts 同款） ────────────────────

const MAX_BODY_BYTES = 64 * 1024

async function readJsonBody(req: HttpRequestLike): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

function writeJson(res: HttpResponseLike, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

// ── 路由 ────────────────────────────────────────────────────────────────────

interface ReflowItemPayload {
  text?: unknown
  sideTitle?: unknown
}

interface ReflowPayload {
  parentSessionId?: unknown
  items?: unknown
}

/** reflow 注入处理：父会话 agent 在 → inject；不在 → ok:false（客户端回落搭车）。
 *  导出供单测（宿主 handler 的 fence/校验/降级路径）。 */
export function makeReflowHandler(ctx: HostContext) {
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<void> => {
    const method = (req as { method?: string }).method
    if (method !== 'POST') {
      writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    const webRuntime = ctx.get('webRuntime') as WebRuntimeLike | undefined
    if (!isTrustedApiRequest(req, webRuntime?.trustedHosts ?? [])) {
      writeJson(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    let body: ReflowPayload
    try {
      body = await readJsonBody(req) as ReflowPayload
    } catch {
      writeJson(res, 400, { ok: false, error: 'bad-request' })
      return
    }
    const items = Array.isArray(body.items) ? body.items as ReflowItemPayload[] : []
    const valid = items.map((item, index) => ({ item, index })).filter(({ item }) => typeof item.text === 'string' && item.text !== '')
    if (typeof body.parentSessionId !== 'string' || body.parentSessionId === '' || valid.length === 0) {
      writeJson(res, 400, { ok: false, error: 'bad-request: parentSessionId/items required' })
      return
    }
    const agents = ctx.get('agents') as AgentsLike | undefined
    const agent = agents?.get(body.parentSessionId)
    if (agent === undefined || typeof agent.inject !== 'function') {
      // 父会话无 live agent（未在屏/冷）——客户端回落搭车形态。
      writeJson(res, 200, { ok: false, error: 'no-live-agent' })
      return
    }
    // summary 收敛到官方上限（CONTEXT_SUMMARY_MAX_CHARS=120；审查 m3）。
    const injectedIndexes: number[] = []
    for (const { item, index } of valid) {
      const sideTitle = typeof item.sideTitle === 'string' ? item.sideTitle : ''
      const summary = (sideTitle === '' ? '侧边聊天的结论回流' : `来自「${sideTitle}」的结论回流`).slice(0, 120)
      try {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: item.text as string }],
          source: {
            // V4 rejects the retired { kind:'plugin', plugin:... } wrapper.
            // A producer-owned kind is also accepted by earlier extensible sources.
            kind: 'dsh-sidenote',
            // form:'notice' + summary：折叠行直接显示回流摘要（不声明则 opaque
            // 渲染、折叠行只显示原始 plugin 串——审查 M2）。
            form: 'notice',
            summary,
          },
        }))
        injectedIndexes.push(index)
      } catch (error) {
        // agent 在 get 与 inject 之间被回收：本条注入失败，其余继续。
        console.warn('[dsh-sidenote] reflow 注入单条失败:', error)
      }
    }
    writeJson(res, 200, { ok: injectedIndexes.length === valid.length, injectedIndexes })
  }
}

export function apply(ctx: unknown): void {
  const host = ctx as HostContext
  // webServer 面的获取必须走动态 inject（等服务）：cordis 的 ctx.get 对未在
  // inject 清单里的服务不可达（真机实证：静态 get 探测拿到 undefined，
  // 路由静默不注册）。webServer 在 headless/CLI 形态缺席——inject 回调永不
  // 触发即降级（客户端回落搭车），不阻塞插件装载。
  const injectDyn = (host as { inject?: (deps: string[], cb: (injected: { get(name: string): unknown }) => void | (() => void)) => unknown }).inject
  if (typeof injectDyn !== 'function') {
    console.warn('[dsh-sidenote] 宿主半包：ctx.inject 面缺席，reflow 路由未注册（客户端回落搭车）')
    return
  }
  injectDyn.call(ctx, ['sessionProjections'], (injected) => {
    const registry = injected.get('sessionProjections') as { register(definition: typeof contextProjection): () => void }
    return registry.register(contextProjection)
  })
  injectDyn.call(ctx, ['webServer'], (injected) => {
    const webServer = injected.get('webServer') as WebServerLike | undefined
    if (webServer === undefined || typeof webServer.register !== 'function') return
    console.log('[dsh-sidenote] 宿主半包已装载，注册 /sidenote/reflow')
    return webServer.register({
      kind: 'exact',
      path: '/sidenote/reflow',
      handler: makeReflowHandler(host),
    })
  })
}
