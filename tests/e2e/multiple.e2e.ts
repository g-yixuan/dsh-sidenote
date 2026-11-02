import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { restartHost } from './host'
import { dragText, openSeedSession, openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => { await page.screenshot({ path: info.outputPath('multiple-tabs.png') }) })
const inputOf = (view: Locator) => view.locator('[data-composer-input]')
const mainOf = (page: Page) => page.locator('[data-conversation-session]').first()
const tabOf = (page: Page, id: string) => page.getByRole('tab').filter({ has: page.locator(`[data-sidebar-right-tab="${id}"]`) })
const tabIdOf = (side: Locator) => side.locator('xpath=ancestor::*[@data-sidebar-right-tab][1]').getAttribute('data-sidebar-right-tab') as Promise<string>
const stop = /^(Stop generating|停止生成)$/
const reflow = /^(Bring back to main conversation|带回主对话)$/

async function sideCommand(page: Page, option: RegExp) {
  await inputOf(mainOf(page)).fill('/side')
  await page.getByRole('option', { name: /^side /i }).click()
  await page.getByRole('option', { name: option }).first().click()
}
async function createAnother(page: Page): Promise<string> {
  const previous = await sideChatOf(page).getAttribute('data-sidenote-chat-session')
  await sideCommand(page, /^(New side chat|新建侧边聊天)/)
  await expect.poll(() => sideChatOf(page).getAttribute('data-sidenote-chat-session')).not.toBe(previous)
  await expect(inputOf(sideChatOf(page))).toBeVisible()
  return (await sideChatOf(page).getAttribute('data-sidenote-chat-session'))!
}
async function send(view: Locator, id: string, text: string) {
  const before = sessionEventsOf(id).filter(e => e.type === 'turn/end').length
  await inputOf(view).fill(text); await inputOf(view).press('Enter')
  await expect.poll(() => sessionEventsOf(id).filter(e => e.type === 'turn/end').length, { timeout: 120_000 }).toBe(before + 1)
  expect(sessionEventsOf(id).findLast(e => e.type === 'turn/end')?.data.reason.kind).toBe('completed')
  await expect(view.getByRole('button', { name: stop })).toHaveCount(0)
}

for (const real of [false, true]) test(`${real ? 'account Flash ' : ''}multiple: independent histories, drafts, reopen, process recovery, reflow and save`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_ACCOUNT_MODEL, 'Requires an isolated native DeepSeek account')
  test.setTimeout(real ? 480_000 : 180_000)
  const model = real ? process.env.DSH_E2E_ACCOUNT_MODEL! : 'Controlled E2E'
  const markerA = 'A-' + randomUUID(), markerB = 'B-' + randomUUID()
  if (real) for (const [name, code] of [['multi-a.txt', markerA], ['multi-b.txt', markerB]]) writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, name!), code! + '\n')
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)))
  await prepareSeedPage(page)
  const a = await openSideChat(page), side = sideChatOf(page)
  const tabA = await tabIdOf(side)
  await selectModel(page, side, model)
  const questionA = real ? '只调用 read 读取 multi-a.txt，记住其中的核验码，只回复“记住了”。不要读取其他文件。' : 'MULTI-A: private question belonging only to A'
  await send(side, a, questionA)
  await inputOf(side).fill('draft retained in A')
  const b = await createAnother(page), tabB = await tabIdOf(side)
  expect(b).not.toBe(a)
  await expect(tabOf(page, tabA)).toBeVisible()
  await selectModel(page, side, model)
  const questionB = real ? '只调用 read 读取 multi-b.txt，记住其中的核验码，只回复“记住了”。不要读取其他文件。' : 'MULTI-B: private question belonging only to B'
  await send(side, b, questionB)
  expect(userMessagesOf(a).some(text => text.includes(questionB))).toBe(false)
  expect(userMessagesOf(b).some(text => text.includes(questionA))).toBe(false)
  if (real) for (const [id, own, other] of [[a, markerA, markerB], [b, markerB, markerA]]) {
    const tools = sessionEventsOf(id!).filter(e => e.type === 'tool/result')
    expect(tools.some(e => JSON.stringify(e.data).includes(own!))).toBe(true)
    expect(tools.some(e => JSON.stringify(e.data).includes(other!))).toBe(false)
  }
  await tabOf(page, tabA).click()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', a)
  await expect(inputOf(side)).toHaveText('draft retained in A')
  await inputOf(side).fill('')
  await tabOf(page, tabA).getByRole('button', { name: /^(Close|关闭)$/ }).click()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', b)
  await sideCommand(page, /^(Reopen|重开)/)
  await expect(side).toHaveAttribute('data-sidenote-chat-session', a)
  const reopenedA = await tabIdOf(side)
  await expect(tabOf(page, tabB)).toBeVisible()
  await restartHost(page)
  await expect(side).toHaveAttribute('data-sidenote-chat-session', a)
  await expect(side.locator('[data-chat-flow-kind="user"]')).toContainText(questionA)
  await send(side, a, real ? '不要调用工具，只回复本会话之前读取的完整核验码。' : 'MULTI-A: continue after restart')
  if (real) {
    await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(markerA)
    await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).not.toContainText(markerB)
  }
  await tabOf(page, tabB).click()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', b)
  await expect(side.locator('[data-chat-flow-kind="user"]')).toContainText(questionB)
  await send(side, b, real ? '不要调用工具，只回复本会话之前读取的完整核验码。' : 'MULTI-B: continue after restart')
  if (real) await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(markerB)
  for (const id of [a, b]) expect(userMessagesOf(id).filter(text => text.includes('<mainline-progress-snapshot '))).toHaveLength(1)
  await side.getByRole('button', { name: reflow }).last().click()
  await expect(page.getByText(/1 side-chat reflow|1 条侧边回流/).first()).toBeVisible()
  if (real) {
    await selectModel(page, mainOf(page), model)
    await send(mainOf(page), process.env.DSH_E2E_SEED_SESSION!, '不要调用工具，只回复刚刚侧边回流中的完整核验码。')
    await expect(mainOf(page).locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(markerB)
  }
  await side.getByRole('button', { name: /^(Save as session|保存为正式会话)$/ }).click()
  await expect(mainOf(page)).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  const saved = (await mainOf(page).getAttribute('data-conversation-session'))!
  expect(userMessagesOf(saved).some(text => text.includes(questionB))).toBe(true)
  await openSeedSession(page)
  await tabOf(page, reopenedA).click()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', a)
  await expect(tabOf(page, tabB)).toHaveCount(0)
  expect(errors).toEqual([])
  const wire = real ? JSON.parse(readFileSync(join(process.env.DSH_E2E_HOME!, '..', 'official-wire.json'), 'utf8')) : []
  if (real) expect(wire.every((r: { model: string; status: number; finished: boolean }) => r.model === 'deepseek-flash' && r.status === 200 && r.finished)).toBe(true)
  writeFileSync(test.info().outputPath('multiple.json'), JSON.stringify({ a, b, saved, real, historiesIsolated: true, originalReopened: true, processRecovery: true, siblingSurvivesSave: true, wire }, null, 2) + '\n')
})

test('multiple: current-tab quote target stays frozen while switching and background runs stop independently', async ({ page }) => {
  await prepareSeedPage(page)
  const a = await openSideChat(page), side = sideChatOf(page), tabA = await tabIdOf(side)
  const b = await createAnother(page), tabB = await tabIdOf(side)
  await selectModel(page, side, 'Controlled E2E')
  await tabOf(page, tabA).click()
  await selectModel(page, side, 'Controlled E2E')
  const source = mainOf(page).locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()
  await dragText(page, source, 'full history snapshot')
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByRole('button', { name: /Ask in side chat|在侧边聊天中提问/ }).click()
  await overlay.locator('input').fill('frozen in A')
  await tabOf(page, tabB).click()
  await expect(overlay.locator('input')).toHaveCount(0)
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), a)).toMatchObject([{ note: 'frozen in A', state: 'active' }])
  expect(await page.evaluate(id => localStorage.getItem('dsh-sidenote:annotations:v1:' + id), b)).toBeNull()
  await tabOf(page, tabA).click()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', a)
  await send(side, a, 'SEND-QUOTE-A')
  expect(userMessagesOf(a).some(t => t.includes('frozen in A') && t.includes('<annotation'))).toBe(true)
  expect(userMessagesOf(b).some(t => t.includes('frozen in A'))).toBe(false)
  await inputOf(side).fill('RUN-A [e2e:hold]'); await inputOf(side).press('Enter')
  await expect(side.getByRole('button', { name: stop })).toBeVisible()
  await tabOf(page, tabB).click()
  await inputOf(side).fill('RUN-B [e2e:hold]'); await inputOf(side).press('Enter')
  await expect(side.getByRole('button', { name: stop })).toBeVisible()
  await tabOf(page, tabA).click()
  await side.getByRole('button', { name: stop }).click()
  await expect(side.getByRole('button', { name: stop })).toHaveCount(0)
  await tabOf(page, tabB).click()
  await expect(side.getByRole('button', { name: stop })).toBeVisible()
  await side.getByRole('button', { name: stop }).click()
  await expect(side.getByRole('button', { name: stop })).toHaveCount(0)
})

test('multiple: native plus and slash creation remain independent while earlier forks are pending', async ({ page }) => {
  await prepareSeedPage(page)
  const first = await openSideChat(page)
  const gates: (() => void)[] = []
  let forks = 0
  await page.route(/\/api\/session\/fork$/, async route => {
    forks++
    const response = await route.fetch()
    await new Promise<void>(resolve => { gates.push(resolve) })
    await route.fulfill({ response })
  })
  try {
    await page.getByRole('button', { name: /^(New tab|新标签页)$/ }).click()
    await page.locator('[data-sidebar-right-guide-entry="dsh-sidenote:side"]').click()
    await expect.poll(() => gates.length).toBe(1)
    await sideCommand(page, /^(New side chat|新建侧边聊天)/)
    await expect.poll(() => gates.length).toBe(2)
    for (const release of [...gates].reverse()) release()
    const views = page.locator('[data-sidenote-chat-session]')
    await expect(views).toHaveCount(3)
    const ids = await views.evaluateAll(elements => elements.map(el => el.getAttribute('data-sidenote-chat-session')!))
    expect(new Set(ids).size).toBe(3)
    expect(ids).toContain(first)
    for (const id of ids) {
      const view = page.locator(`[data-sidenote-chat-session="${id}"]`)
      await tabOf(page, await tabIdOf(view)).click()
      await selectModel(page, view, 'Controlled E2E')
      await send(view, id, 'exclusive marker ' + id)
    }
    for (const id of ids) for (const other of ids.filter(other => other !== id)) expect(userMessagesOf(id).some(t => t.includes(other))).toBe(false)
    await page.reload()
    for (const id of ids) {
      // Titles can be truncated; recover each id from the persisted tab identity.
      const tabId = await page.evaluate(child => Object.keys(sessionStorage).filter(k => k.startsWith('dsh-sidenote:side-meta:v1:')).map(k => JSON.parse(sessionStorage.getItem(k)!)).find(m => m.childId === child)?.tabId, id)
      expect(tabId).toBeTruthy()
      await tabOf(page, tabId).click()
      await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', id)
    }
    expect(forks).toBe(2)
  } finally { for (const release of gates) release() }
})
