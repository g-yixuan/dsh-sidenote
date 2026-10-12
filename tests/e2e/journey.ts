import { expect, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { createHostApi, gotoPage, hostRpc } from './host'

export async function registerSeedWorkspace(): Promise<void> {
  const workspace = process.env.DSH_E2E_WORKSPACE
  if (!workspace || !process.env.DSH_E2E_SEED_SESSION) throw new Error('Run via scripts/e2e-mount.sh with a seeded workspace')
  const api = await createHostApi()
  await hostRpc(api, 'workspace.create', { path: workspace })
  await api.dispose()
}

/** Keyless onboarding is optional; when present, every takeover must close. */
export async function dismissOnboarding(page: Page): Promise<void> {
  const names = /^(Continue|Configure later|继续|稍后配置|稍后再说)$/
  try {
    await expect.poll(() => page.getByRole('button', { name: names }).count(), { timeout: 5_000 }).toBeGreaterThan(0)
  } catch {
    // A previously configured synthetic profile need not show onboarding.
  }
  for (let round = 0; round < 10; round++) {
    const buttons = page.getByRole('button', { name: names })
    if (await buttons.count() === 0) break
    // A registered local provider can complete onboarding automatically while
    // its disabled Continue is on screen. Wait for enabled OR genuinely gone.
    await expect.poll(() => buttons.evaluateAll(elements => {
      const last = elements.at(-1)
      return last === undefined ? 'gone' : last instanceof HTMLButtonElement && !last.disabled ? 'ready' : 'loading'
    }), { timeout: 15_000 }).not.toBe('loading')
    if (await buttons.count() === 0) break
    try { await buttons.last().click({ timeout: 2_000 }) } catch (error) {
      if (await buttons.count() !== 0) throw error
    }
  }
  await expect(page.locator('[class*="_mask_"]')).toHaveCount(0, { timeout: 15_000 })
}

export async function openSeedSession(page: Page): Promise<void> {
  const seed = process.env.DSH_E2E_SEED_SESSION
  if (!seed) throw new Error('Missing DSH_E2E_SEED_SESSION')
  const open = page.getByRole('button', { name: /^(Open sidebar|打开侧栏)$/ }).first()
  if (await open.isVisible()) await open.click()
  // Wait for the session list before deciding which row identity exists. A
  // zero count on the first frame must not choose the legacy title fallback.
  const titled = page.getByRole('treeitem').filter({ hasText: 'Side chat plugin review' })
  await expect(titled.first()).toBeAttached({ timeout: 30_000 })
  const byId = page.locator(`[role="treeitem"][data-row-key="session:${seed}"]`)
  // Native workspace lists show a limited recent subset. Previous real forks
  // can push the seed behind Show more; expand instead of choosing a child
  // with the same inherited title.
  const overflow = page.locator('button[data-row-key^="overflow:"][aria-expanded="false"]')
  if (await byId.count() === 0 && await overflow.count() > 0) {
    await overflow.first().click()
    await expect(byId).toBeAttached({ timeout: 30_000 })
  }
  const rows = await byId.count() > 0 ? byId : titled
  // Legacy children are archived; an ambiguous legacy title must fail loudly.
  await expect(rows).toHaveCount(1)
  await rows.getByText('Side chat plugin review', { exact: true }).click()
  const conversation = page.locator('[data-conversation-session]').first()
  if (await conversation.count() > 0) await expect(conversation).toHaveAttribute('data-conversation-session', seed)
  await expect(page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()).toBeAttached({ timeout: 30_000 })
}

export async function prepareSeedPage(page: Page): Promise<void> {
  await gotoPage(page)
  await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 90_000 })
  await dismissOnboarding(page)
  await openSeedSession(page)
}

export const sideChatOf = (page: Page) => page.locator('[data-sidenote-chat-session]:visible')

function decodeLog(bytes: Buffer, compressed: boolean): string {
  if (!compressed) return bytes.toString('utf8')
  const frames: Buffer[] = []
  while (bytes.length > 0) {
    // Node stops at one zstd frame. info exposes its consumed input; the
    // @types/node return type does not yet reflect the info=true overload.
    const decoded = zstdDecompressSync(bytes, { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } }
    if (decoded.engine.bytesWritten <= 0) throw new Error('zstd log decoder made no progress')
    frames.push(decoded.buffer)
    bytes = bytes.subarray(decoded.engine.bytesWritten)
  }
  return Buffer.concat(frames).toString('utf8')
}

/** Shared legacy/native requirement: a real child, replayed history and an input. */
export async function openSideChat(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  const side = sideChatOf(page)
  await expect(side).toHaveCount(1, { timeout: 30_000 })
  const child = await side.getAttribute('data-sidenote-chat-session')
  expect(child).toBeTruthy()
  expect(child).not.toBe(process.env.DSH_E2E_SEED_SESSION)
  await expect(side.getByPlaceholder(/^(Message…|输入消息)/)).toBeVisible()
  const history = side.getByText(/full history snapshot/).first()
  if (!await history.isVisible()) await side.getByRole('button', { name: /Inherited from main|继承自主会话/ }).click()
  await expect(history).toBeVisible()
  return child!
}

/** Only the isolated host's durable log is read, never the user's DSH_HOME. */
export function userMessageContentsOf(sessionId: string): Array<Array<{ type: string; text?: string }>> {
  const home = process.env.DSH_E2E_HOME
  if (!home) throw new Error('Missing isolated DSH_E2E_HOME')
  const projects = join(home, 'sessions')
  for (const project of readdirSync(projects, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const sessions = join(projects, project.name)
    if (!readdirSync(sessions).includes(sessionId)) continue
    const dir = join(sessions, sessionId)
    // A migrated seed can keep v0 beside the current v1/v4 log; use the newest format.
    const files = readdirSync(dir).filter(name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name))
      .sort((a, b) => Number(b.match(/\.v(\d+)/)?.[1] ?? 0) - Number(a.match(/\.v(\d+)/)?.[1] ?? 0))
    if (files.length === 0) return []
    const file = files[0]!
    const bytes = readFileSync(join(dir, file))
    const events = decodeLog(bytes, file.endsWith('.zstd')).trim().split('\n').map(line => JSON.parse(line))
    return events.filter(e => e.type === 'user/message' || e.type === 'user/steering').map(e => e.data.content ?? [])
  }
  return []
}

export function userMessagesOf(sessionId: string): string[] {
  return userMessageContentsOf(sessionId).map(content => content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n'))
}
