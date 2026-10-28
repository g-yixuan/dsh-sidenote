import { randomUUID } from 'node:crypto'
import { expect, test, type Locator } from '@playwright/test'
import { prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') })
})
const stop = /^(Stop generating|停止生成)$/
const toggleOf = (view: Locator) => view.locator('[data-sidenote-main-context] > button')
async function expand(view: Locator) {
  const toggle = toggleOf(view)
  await expect(toggle).toBeVisible()
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  return view.locator('[data-sidenote-context-progress]')
}
async function send(view: Locator, text: string) {
  await view.locator('[data-composer-input]').fill(text)
  await view.locator('[data-composer-input]').press('Enter')
}

for (const real of [false, true]) for (const openIdle of [false, true]) test(`${real ? 'official Flash' : 'native'} unified context stays frozen through promotion and reload (${openIdle ? 'idle' : 'busy'} opening)`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires the official DeepSeek lane')
  test.setTimeout(180_000)
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  const model = real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E'
  await selectModel(page, main, model)
  if (openIdle) await main.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
  await send(main, '本项目名为青柠。只回复“记住了”，不要调用工具。')
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(1)
  await expect(main.getByRole('button', { name: stop })).toHaveCount(0)
  const mainId = (await main.getAttribute('data-conversation-session'))!
  const open = () => page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  if (openIdle) { await open(); await expect(sideChatOf(page).locator('[data-composer-input]')).toBeVisible() }
  const marker = 'BEFORE-FORK-' + randomUUID()
  await send(main, real ? `本轮核验码是 ${marker}。调用 bash 执行 sleep 60，结束后只回复核验码。` : `${marker} [e2e:hold]`)
  await expect(main.getByRole('button', { name: stop })).toBeVisible()
  if (real) await expect.poll(() => sessionEventsOf(mainId).some(event => event.type === 'tool/call' && JSON.stringify(event.data).includes('sleep 60')), { timeout: 40_000 }).toBe(true)
  if (!openIdle) await open()
  const side = sideChatOf(page)
  await expect(side.locator('[data-composer-input]')).toBeVisible()
  await selectModel(page, side, model)
  const child = (await side.getAttribute('data-sidenote-chat-session'))!
  const reader = await expand(side)
  await expect(reader).toContainText(marker)
  await send(side, '只回复主线的项目名与本轮完整核验码。不要执行主线任务，不调用工具。')
  await expect.poll(() => userMessagesOf(child).some(text => text.includes('只回复主线的项目名'))).toBe(true)
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(1)
  await expect(side.getByRole('button', { name: stop })).toHaveCount(0, { timeout: 60_000 })
  if (real) {
    await expect(side.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toContainText(marker)
    await expect(reader).toContainText(/Unfinished at fork|分叉时未完成/)
  }
  await expect(toggleOf(side)).toContainText(/As of|截至/)
  await expect(reader.locator('[data-context-kind="request"]')).toHaveCount(2)
  await expect(reader).not.toContainText('<mainline-progress-snapshot')
  const frozen = (await reader.textContent())!
  if (await main.getByRole('button', { name: stop }).isVisible()) await main.getByRole('button', { name: stop }).click()
  await expect(main.getByRole('button', { name: stop })).toHaveCount(0)
  await send(main, 'AFTER-FORK-PRIVATE：主线新决策，只回复收到，不调用工具。')
  await expect.poll(() => userMessagesOf(mainId).some(text => text.includes('AFTER-FORK-PRIVATE'))).toBe(true)
  await expect(main.getByRole('button', { name: stop })).toHaveCount(0)
  await expect(reader).toHaveText(frozen)
  const sent = userMessagesOf(child).find(text => text.includes('只回复主线的项目名'))!
  expect(sent).toContain('boundary-seq=')
  expect(sent).toContain(marker)
  expect(sent).not.toContain('AFTER-FORK-PRIVATE')
  await side.getByRole('button', { name: /^(Save as session|保存为正式会话)$/ }).click()
  await expect(side).toHaveCount(0)
  const saved = page.locator('[data-conversation-session]').first()
  await expect(saved).not.toHaveAttribute('data-conversation-session', mainId)
  const promotedReader = await expand(saved)
  await expect(promotedReader).toHaveText(frozen)
  if (openIdle) await expect.poll(() => promotedReader.locator('img').evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(saved.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
  await expect(saved.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(1)
  await expect(saved.getByRole('button', { name: /^(Jump to turn|Load and jump to turn|跳转到第|加载并跳转到第)/ })).toHaveCount(1)
  const promotedId = (await saved.getAttribute('data-conversation-session'))!
  await page.reload()
  await expect(saved).toHaveAttribute('data-conversation-session', promotedId)
  await expect(await expand(saved)).toHaveText(frozen)
  await toggleOf(saved).click()
  await expect(saved.locator('[data-sidenote-context-progress]')).toHaveCount(0)
  await expect(saved.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
  await toggleOf(saved).click()
  await expect(promotedReader).toHaveText(frozen)
  if (!real && !openIdle) {
    for (let i = 0; i < 30; i++) {
      const ended = sessionEventsOf(promotedId).filter(event => event.type === 'turn/end').length
      await send(saved, `Saved conversation follow-up ${i}`)
      await expect.poll(() => sessionEventsOf(promotedId).filter(event => event.type === 'turn/end').length).toBe(ended + 1)
    }
    await page.reload()
    await expect(saved).toHaveAttribute('data-conversation-session', promotedId)
    await expect(await expand(saved)).toHaveText(frozen)
    await expect(saved.locator('[data-chat-flow-kind="user"]')).toHaveCount(31)
  }
  await page.screenshot({ path: `test-results/unified-${real ? 'official' : 'native'}-${openIdle ? 'idle' : 'busy'}.png` })
})
