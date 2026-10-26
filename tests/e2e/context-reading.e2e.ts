import { expect, test, type Locator } from '@playwright/test'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sideChatOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') })
})

async function send(view: Locator, message: string): Promise<void> {
  const replies = view.getByText('Second paragraph preserves the full selected text.', { exact: true })
  const before = await replies.count()
  await view.locator('[data-composer-input]').fill(message)
  await view.locator('[data-composer-input]').press('Enter')
  await expect(replies).toHaveCount(before + 1)
  await expect(view.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
}

async function endIsVisible(row: Locator): Promise<boolean> {
  return row.evaluate(element => {
    const scroller = element.closest('[data-conversation-scroll]')!
    const view = scroller.getBoundingClientRect()
    const bottom = scroller.querySelector('[data-composer-seat]')?.getBoundingClientRect().top ?? view.bottom
    const rect = element.getBoundingClientRect()
    return rect.height > 0 && rect.bottom > view.top + 32 && rect.bottom <= bottom
  })
}

test('context expansion lands at the latest inherited message, with older history above', async ({ page }) => {
  await prepareSeedPage(page)
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'Controlled E2E')
  await send(main, 'Latest main context before opening a side chat.')
  const latestKey = await main.locator('[data-chat-flow-kind="assistant-step"]').last().getAttribute('data-chat-flow-key')
  expect(latestKey).toBeTruthy()
  await openSideChat(page)
  const side = sideChatOf(page)
  const toggle = side.locator('[data-sidenote-main-context] button')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const latest = side.locator(`[data-chat-flow-key=${JSON.stringify(latestKey)}]`)
  for (let i = 0; i < 3; i++) {
    await send(side, `Side discussion ${i}: keep this conversation separate from the inherited context.`)
  }
  await side.locator('[data-composer-input]').fill('Keep reading inherited context while this reply finishes [e2e:hold]')
  await side.locator('[data-composer-input]').press('Enter')
  const stop = side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  await expect(stop).toBeVisible()
  await expect(side.getByText('Second paragraph preserves the full selected text.', { exact: true })).toHaveCount(4)
  const mainTop = await main.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop)
  await toggle.click()
  await expect.poll(() => endIsVisible(latest)).toBe(true)
  expect(await main.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop)).toBe(mainTop)
  await page.screenshot({ path: 'test-results/context-latest-open.png' })
  const scroll = side.locator('[data-conversation-scroll]')
  const top = await scroll.evaluate(el => el.scrollTop)
  expect(top).toBeGreaterThan(100)
  await latest.hover()
  await page.mouse.wheel(0, -260)
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeLessThan(top - 100)
  const readingTop = await scroll.evaluate(el => el.scrollTop)
  await expect(stop).toHaveCount(0, { timeout: 45_000 })
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeCloseTo(readingTop, 0)
  await toggle.click()
  await toggle.click()
  await expect.poll(() => endIsVisible(latest)).toBe(true)
})

test('context expansion opens running progress at its newest entry', async ({ page }) => {
  await prepareSeedPage(page)
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'Controlled E2E')
  const replies = main.getByText('Second paragraph preserves the full selected text.', { exact: true })
  const before = await replies.count()
  const message = Array.from({ length: 24 }, (_, i) => `Main progress detail ${i + 1}`).join('\n') + '\n[e2e:hold]'
  await main.locator('[data-composer-input]').fill(message)
  await main.locator('[data-composer-input]').press('Enter')
  const stop = main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  await expect(stop).toBeVisible()
  await expect(replies).toHaveCount(before + 1)
  await openSideChat(page)
  const side = sideChatOf(page)
  const progress = side.locator('[data-sidenote-context-progress]')
  await expect.poll(() => progress.evaluate(el => ({
    overflowing: el.scrollHeight > el.clientHeight,
    atEnd: el.scrollHeight - el.scrollTop - el.clientHeight < 2,
  }))).toEqual({ overflowing: true, atEnd: true })
  await expect.poll(() => endIsVisible(progress)).toBe(true)
  await progress.hover()
  await page.mouse.wheel(0, -120)
  await expect.poll(() => progress.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(50)
  const toggle = side.locator('[data-sidenote-main-context] button')
  await toggle.click()
  await toggle.click()
  await expect.poll(() => progress.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  await expect.poll(() => endIsVisible(progress)).toBe(true)
  await stop.click()
})

test('context expansion with empty progress falls back to the latest inherited message', async ({ page }) => {
  await prepareSeedPage(page)
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'Controlled E2E')
  await send(main, 'Latest completed main turn before sending an image alone')
  const latestKey = await main.locator('[data-chat-flow-kind="assistant-step"]').last().getAttribute('data-chat-flow-key')
  expect(latestKey).toBeTruthy()
  await main.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
  await main.getByRole('button', { name: /^(Send message|发送消息)$/ }).click()
  const stop = main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  await expect(stop).toBeVisible()
  try {
    await openSideChat(page)
    const side = sideChatOf(page)
    await expect(side.locator('[data-sidenote-main-context]')).toContainText(/Updates on first send|发送时更新/)
    await expect(side.locator('[data-sidenote-context-progress]')).toHaveCount(0)
    const latest = side.locator(`[data-chat-flow-key=${JSON.stringify(latestKey)}]`)
    await expect.poll(() => endIsVisible(latest)).toBe(true)
    const toggle = side.locator('[data-sidenote-main-context] button')
    await toggle.press('Enter')
    await toggle.press('Enter')
    await expect.poll(() => endIsVisible(latest)).toBe(true)
    await expect(stop).toBeVisible()
    await page.screenshot({ path: 'test-results/context-empty-progress.png' })
  } finally {
    if (await stop.isVisible()) await stop.click()
  }
})
