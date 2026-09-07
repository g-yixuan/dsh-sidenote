/**
 * Host-transport glue for the mount lane, spanning the DSH 0.1.1-rc.x →
 * 0.1.2 breaking split (Remote gateway + one-time-token browser auth).
 * Ported from dsh-better-sidebar's verified dual-dialect adapter
 * (tests/e2e/host-protocol.ts + tests/e2e/host.ts) and trimmed to what this
 * repo's single lane needs: one goto shape + one RPC method.
 *
 * DSH 0.1.2 protocol facts (verified against a live 0.1.2-rc.1 host with
 * better-sidebar 0.18.0 mounted; see dsh-better-sidebar AGENTS §3):
 *
 * - `dsh web` prints an AUTHENTICATED launch URL — `dsh web:
 *   http://127.0.0.1:<port>/?token=<43 base64url chars>`. Navigating it
 *   answers 303 with a signed cookie (HttpOnly, SameSite=Strict) that every
 *   `/api` request and the index HTML must then carry; the clean URL
 *   answers 401. Older hosts print a bare origin and have no browser auth.
 * - The legacy ApiProxy dot-method endpoints (`POST /api/workspace.create`
 *   with a bare payload) were replaced by the Remote gateway's slash
 *   endpoints — `POST /api/workspace/create` with `payload: { args }` whose
 *   args object is keyed by the controller's TypeScript PARAMETER name
 *   (`workspace/create` declares a single `request` parameter); a dot path
 *   is no longer claimed (404). The `{type:'client-request', rpcId,
 *   method, payload}` envelope is unchanged.
 */
import { request, type APIRequestContext, type Page } from '@playwright/test'

const envUrl = process.env.DSH_E2E_URL
if (!envUrl) {
  throw new Error('DSH_E2E_URL is not set — run via scripts/e2e-mount.sh')
}
// Re-bind with an explicit string type: closure bodies below do not inherit
// the guard's narrowing of envUrl.
const RAW_URL: string = envUrl

const LAUNCH = new URL(RAW_URL)

/** Origin for URL construction (a token URL would corrupt path joins). */
export const ORIGIN = LAUNCH.origin

/** The one-time launch token, when the host printed one (0.1.2+). */
const TOKEN: string | undefined = LAUNCH.searchParams.get('token') ?? undefined

/** Exchange the one-time launch token for the auth-cookie pair: the token
 * URL answers 303 with Set-Cookie (following the redirect would drop it,
 * hence `redirect: 'manual'`). Once per process — the exchanged cookie
 * stays valid for the whole lane run. */
async function exchangeLaunchCookie(): Promise<string> {
  const res = await fetch(RAW_URL, { redirect: 'manual' })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie === null) {
    throw new Error(
      `token exchange failed: HTTP ${res.status} carried no set-cookie — cannot authenticate page navigation / workspace seeding`,
    )
  }
  return setCookie.split(';', 1)[0] ?? ''
}

/** The `name=value` cookie pair, exchanged lazily once per process. */
let cookieHeader: string | undefined

/** page.goto through the host auth. On a token host the cookie is exchanged
 * once (process-wide) and seeded into each test's fresh browser context
 * before navigating the origin directly — deliberately NOT re-navigating
 * the token URL per test: the token's reusability is not a contract, while
 * this exchange → addCookies → origin path is exactly what better-sidebar's
 * stamped navigation does on a verified 0.1.2 host. On older hosts it is a
 * plain goto of the bare origin. */
export async function gotoPage(page: Page): Promise<void> {
  if (TOKEN !== undefined) {
    if (cookieHeader === undefined) cookieHeader = await exchangeLaunchCookie()
    const eq = cookieHeader.indexOf('=')
    await page.context().addCookies([{
      name: cookieHeader.slice(0, eq),
      value: cookieHeader.slice(eq + 1),
      url: ORIGIN,
    }])
  }
  await page.goto(TOKEN === undefined ? RAW_URL : ORIGIN, { waitUntil: 'domcontentloaded' })
}

/** Authenticated request context for host RPC seeding (cookie attached when
 * the launch URL carried a one-time token; plain on older hosts). */
export async function createHostApi(): Promise<APIRequestContext> {
  if (cookieHeader === undefined && TOKEN !== undefined) {
    cookieHeader = await exchangeLaunchCookie()
  }
  return request.newContext({
    baseURL: ORIGIN,
    extraHTTPHeaders: cookieHeader === undefined ? {} : { cookie: cookieHeader },
  })
}

/** The slash-dialect (0.1.2 Remote gateway) args key per host method: the
 * gateway keys the args object by the controller's TypeScript PARAMETER
 * name, not the endpoint's own naming — `workspace/create` declares a
 * single `request` parameter. Verified against a live 0.1.2 host by
 * better-sidebar (every other shape fails `args fields do not match the
 * descriptor`); extend this map before calling any further method. */
const SLASH_ARGS_KEY: Record<string, string> = {
  'workspace.create': 'request',
}

/** One host-RPC protocol attempt. */
interface RpcAttempt {
  protocol: 'dot' | 'slash'
  /** Request path, relative to the origin, starting with `/api/`. */
  path: string
  /** Envelope `method` string — must equal the endpoint the path selects. */
  method: string
  /** Envelope `payload` — the bare args object on dot hosts, `{ args }` on
   * slash hosts (the gateway rejects any other payload shape). */
  payload: Record<string, unknown>
}

/** Build the two dialects of one host RPC: the 0.1.1-rc.x dot endpoint
 * first — every currently-published host answers it, so the deployed lane
 * never pays a probe round-trip — then the 0.1.2+ slash endpoint as the
 * 404 fallback. Throws for methods without a known slash args key: the
 * wrapper is per-parameter, so an unverified shape must fail loudly here
 * instead of as a confusing gateway error mid-lane. */
function rpcAttempts(method: string, args: Record<string, unknown>): RpcAttempt[] {
  const slashKey = SLASH_ARGS_KEY[method]
  if (slashKey === undefined) {
    throw new Error(
      `host: no slash-dialect args key for ${JSON.stringify(method)} — verify the parameter name on the 0.1.2 host and extend SLASH_ARGS_KEY`,
    )
  }
  const slash = method.split('.').join('/')
  return [
    { protocol: 'dot', path: `/api/${method}`, method, payload: args },
    { protocol: 'slash', path: `/api/${slash}`, method: slash, payload: { args: { [slashKey]: args } } },
  ]
}

/** Resolved dialect — cached after the first call so only the first RPC
 * ever pays the 404 probe (dot-first: published hosts answer it directly;
 * 0.1.2+ 404s the dot path and answers the slash one). Capability probe,
 * not a version check — no hardcoded host versions anywhere. */
let protocol: 'dot' | 'slash' | undefined

let rpcCounter = 0

/** Call a host unary RPC (`'workspace.create'`) with the args object both
 * dialects accept. Throws with the response body when the HTTP call or the
 * envelope result fails — workspace seeding is fatal for the lane, so the
 * error text carries everything a report needs. Returns the unwrapped
 * `result.value`. */
export async function hostRpc<T = unknown>(
  api: APIRequestContext,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const attempts = rpcAttempts(method, args)
  const ordered = protocol === 'slash' ? [attempts[1]!, attempts[0]!] : attempts
  rpcCounter += 1
  const rpcId = `e2e-${method}-${rpcCounter}`
  for (const attempt of ordered) {
    const res = await api.post(attempt.path, {
      data: { type: 'client-request', rpcId, method: attempt.method, payload: attempt.payload },
    })
    const bodyText = await res.text()
    if (res.status() === 404 && protocol === undefined) continue // endpoint not claimed on this host → other dialect
    if (!res.ok()) {
      throw new Error(`hostRpc ${method} [${attempt.protocol}] HTTP ${res.status()}: ${bodyText.slice(0, 400)}`)
    }
    let envelope: { type?: string; result?: { ok: true; value: T } | { ok: false; error: unknown } }
    try {
      envelope = JSON.parse(bodyText) as typeof envelope
    } catch {
      throw new Error(`hostRpc ${method} [${attempt.protocol}]: non-JSON response: ${bodyText.slice(0, 400)}`)
    }
    const result = envelope.result
    if (result === undefined || result.ok !== true) {
      throw new Error(`hostRpc ${method} [${attempt.protocol}] envelope error: ${bodyText.slice(0, 400)}`)
    }
    protocol = attempt.protocol
    return result.value
  }
  throw new Error(`hostRpc ${method}: no dialect answered (dot and slash both 404) — is this a DSH web host?`)
}
