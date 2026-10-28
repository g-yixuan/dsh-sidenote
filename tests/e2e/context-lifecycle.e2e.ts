import { randomUUID } from 'node:crypto'
import { expect, test, type Locator } from '@playwright/test'
import { prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') })
})

async function contextPrecedesOwnMessages(side: Locator): Promise<void> {
  await expect(side.locator('[data-sidenote-context-section]')).toHaveCount(1)
  expect(await side.evaluate(element => {
    const context = element.querySelector('[data-sidenote-context-section]')!
    const rows = element.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="assistant-step"], [data-chat-running]')
    return [...rows].every(row => (context.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  })).toBe(true)
}

for (const real of [false, true]) test(`${real ? 'official Flash' : 'native'} zero-history context survives empty, streaming, stopped and restored side chat`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires the official DeepSeek lane')
  test.setTimeout(150_000)
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  const model = real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E'
  await selectModel(page, main, model)
  const marker = 'ZERO-HISTORY-' + randomUUID()
  await main.locator('[data-composer-input]').fill(real ? `主线核验码是 ${marker}。只调用 bash 执行 sleep 60，然后回复完成。` : `${marker} [e2e:hold]`)
  await main.locator('[data-composer-input]').press('Enter')
  const mainId = (await main.getAttribute('data-conversation-session'))!
  const stopName = /^(Stop generating|停止生成)$/
  const mainStop = main.getByRole('button', { name: stopName })
  await expect(mainStop).toBeVisible()
  if (real) await expect.poll(() => sessionEventsOf(mainId).some(event => event.type === 'tool/call' && JSON.stringify(event.data).includes('sleep 60')), { timeout: 30_000 }).toBe(true)
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  const side = sideChatOf(page)
  const sideStop = side.getByRole('button', { name: stopName })
  try {
    await expect(side.locator('[data-composer-input]')).toBeVisible()
    const child = (await side.getAttribute('data-sidenote-chat-session'))!
    expect(sessionEventsOf(child).some(event => event.type === 'session/end-seed')).toBe(false)
    expect(sessionEventsOf(mainId).some(event => event.type === 'turn/end')).toBe(false)
    const toggle = side.locator('[data-sidenote-main-context] > button')
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
    const context = side.locator('[data-sidenote-context-progress]')
    await expect(context).toContainText(marker)
    await expect(side.locator('[data-chat-flow-kind="user"]')).toHaveCount(0)
    await page.screenshot({ path: `test-results/${real ? 'official' : 'native'}-empty-context.png` })
    await selectModel(page, side, model)
    if (real) await side.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
    const question = real ? '先调用 bash 执行 sleep 8，然后只回复主线核验码，不调用其他工具。' : 'How is the main task going? [e2e:hold]'
    await side.locator('[data-composer-input]').fill(question)
    await side.locator('[data-composer-input]').press('Enter')
    await expect(sideStop).toBeVisible()
    await expect(side.locator('[data-chat-running]')).toHaveCount(1)
    await expect(side.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
    await contextPrecedesOwnMessages(side)
    await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
    const frozen = await context.textContent()
    if (real) {
      await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(marker, { timeout: 60_000 })
      await expect(sideStop).toHaveCount(0)
      await contextPrecedesOwnMessages(side)
      await side.locator('[data-composer-input]').fill('现在调用 bash 执行 sleep 45，等结束后回复完成。')
      await side.locator('[data-composer-input]').press('Enter')
      await expect(sideStop).toBeVisible()
    }
    await page.screenshot({ path: `test-results/${real ? 'official' : 'native'}-running-context.png` })
    await contextPrecedesOwnMessages(side)
    await sideStop.click()
    await expect(sideStop).toHaveCount(0)
    await contextPrecedesOwnMessages(side)
    await expect(context).toHaveText(frozen!)
    expect(userMessagesOf(child).filter(text => text.includes('<mainline-progress-snapshot '))).toHaveLength(1)
    if (await mainStop.isVisible()) await mainStop.click()
    await page.reload()
    await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
    await expect(context).toHaveText(frozen!)
    await contextPrecedesOwnMessages(side)
    await toggle.click()
    await expect(context).toHaveCount(0)
    await expect(side.locator('[data-chat-flow-kind="user"]')).toHaveCount(real ? 2 : 1)
    await toggle.click()
    await expect(context).toHaveText(frozen!)
    await page.screenshot({ path: `test-results/${real ? 'official' : 'native'}-restored-context.png` })
  } finally {
    if (await sideStop.isVisible()) await sideStop.click()
    if (await mainStop.isVisible()) await mainStop.click()
  }
})

test('inherited images and formatted replies remain readable in the independent context region', async ({ page }) => {
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  await selectModel(page, main, 'Controlled E2E')
  await main.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
  await main.locator('[data-composer-input]').fill('Keep this attachment in the inherited context')
  await main.locator('[data-composer-input]').press('Enter')
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]')).toHaveCount(1)
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  const side = sideChatOf(page)
  const toggle = side.locator('[data-sidenote-main-context] > button')
  await expect(toggle).toBeVisible()
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  const image = side.locator('[data-sidenote-context-history] img')
  await expect(image).toHaveCount(1)
  await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(side.locator('[data-sidenote-context-history] [data-context-kind="reply"] p')).toHaveCount(2)
  await toggle.click()
  await expect(image).toHaveCount(0)
  await toggle.click()
  await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/inherited-context-image.png' })
})
