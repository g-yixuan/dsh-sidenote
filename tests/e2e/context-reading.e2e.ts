import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, userMessagesOf, sideChatOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') })
})

async function send(view: Locator, message: string): Promise<void> {
  const replies = view.locator('[data-chat-flow-kind="assistant-step"]').getByText('Second paragraph preserves the full selected text.', { exact: true })
  const before = await replies.count()
  await view.locator('[data-composer-input]').fill(message)
  await view.locator('[data-composer-input]').press('Enter')
  await expect(replies).toHaveCount(before + 1)
  await expect(view.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
}

async function endIsVisible(row: Locator): Promise<boolean> {
  return row.evaluate(element => {
    const scroller = element.parentElement!.closest('[data-sidenote-context-progress]') ?? element.closest('[data-conversation-scroll]')!
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
  await openSideChat(page)
  const side = sideChatOf(page)
  const toggle = side.locator('[data-sidenote-main-context] > button')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const latest = side.locator('[data-sidenote-context-history] [data-context-kind="reply"]').last()
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
  const scroll = side.locator('[data-sidenote-context-progress]')
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

test('running context follows history, tracks live progress, and respects reader scroll before freezing', async ({ page }) => {
  await prepareSeedPage(page)
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'Controlled E2E')
  const replies = main.getByText('Second paragraph preserves the full selected text.', { exact: true })
  const before = await replies.count()
  const message = Array.from({ length: 24 }, (_, i) => `Main progress detail ${i + 1}`).join('\n') + '\n[e2e:progress-stream]'
  await main.locator('[data-composer-input]').fill(message)
  await main.locator('[data-composer-input]').press('Enter')
  const stop = main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  await expect(stop).toBeVisible()
  await expect(replies).toHaveCount(before + 1)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  const progress = side.locator('[data-sidenote-context-progress]')
  await expect.poll(() => progress.evaluate(el => ({
    overflowing: el.scrollHeight > el.clientHeight,
    atEnd: el.scrollHeight - el.scrollTop - el.clientHeight < 2,
  }))).toEqual({ overflowing: true, atEnd: true })
  await expect.poll(() => endIsVisible(progress)).toBe(true)
  await page.screenshot({ path: 'test-results/context-live-preview.png' })
  const inherited = side.locator('[data-sidenote-context-history] [data-context-kind="reply"]').last()
  expect((await inherited.boundingBox())!.y).toBeLessThan((await side.locator('[data-sidenote-context-increment]').boundingBox())!.y)
  const live = () => progress.textContent()
  const firstText = await live()
  await expect.poll(live).not.toBe(firstText)
  await expect.poll(() => progress.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  await progress.hover()
  await page.mouse.wheel(0, -120)
  await expect.poll(() => progress.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(50)
  const readingTop = await progress.evaluate(el => el.scrollTop)
  const readingText = await live()
  await expect.poll(live).not.toBe(readingText)
  await expect.poll(() => progress.evaluate(el => el.scrollTop)).toBeCloseTo(readingTop, 0)
  await side.getByRole('button', { name: /Back to latest|回到最新/ }).click()
  await expect.poll(() => progress.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  const toggle = side.locator('[data-sidenote-main-context] > button')
  await toggle.click()
  await toggle.click()
  await expect.poll(() => progress.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  await expect.poll(() => endIsVisible(progress)).toBe(true)
  await side.locator('[data-composer-input]').fill('Use this frozen progress in the side conversation')
  await side.locator('[data-composer-input]').press('Enter')
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
  const bubble = side.locator('[data-chat-flow-kind="user"]').filter({ hasText: 'Use this frozen progress' })
  await expect(bubble).toBeVisible()
  expect((await progress.boundingBox())!.y).toBeLessThan((await bubble.boundingBox())!.y)
  const frozen = await live()
  const latestMain = main.locator('[data-chat-flow-kind="assistant-step"]').last()
  const mainText = await latestMain.textContent()
  await expect.poll(() => latestMain.textContent()).not.toBe(mainText)
  expect(await live()).toBe(frozen)
  await page.screenshot({ path: 'test-results/context-live-follow.png' })
  await stop.click()
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(progress).toHaveText(frozen!)
})

for (const imageOnly of [false, true]) test(`context expansion targets ${imageOnly ? 'the latest image-only progress' : 'the latest inherited message when progress is empty'}`, async ({ page }) => {
  await prepareSeedPage(page)
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'Controlled E2E')
  await send(main, 'Latest completed main turn before opening the context reader')
  const stop = main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  if (imageOnly) {
    await main.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
    await main.getByRole('button', { name: /^(Send message|发送消息)$/ }).click()
    await expect(stop).toBeVisible()
  }
  try {
    await openSideChat(page)
    const side = sideChatOf(page)
    await expect(side.locator('[data-sidenote-main-context]')).toContainText(/Updates on first send|发送时更新/)
    await expect(side.locator('[data-sidenote-context-increment]')).toHaveCount(imageOnly ? 1 : 0)
    // Image-only input is real progress too; only a genuinely empty suffix
    // should fall back to the latest inherited reply.
    const latest = imageOnly ? side.locator('[data-sidenote-context-increment] img')
      : side.locator('[data-sidenote-context-history] [data-context-kind="reply"]').last()
    if (imageOnly) await expect.poll(() => latest.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => endIsVisible(latest)).toBe(true)
    const toggle = side.locator('[data-sidenote-main-context] > button')
    await toggle.press('Enter')
    await toggle.press('Enter')
    await expect.poll(() => endIsVisible(latest)).toBe(true)
    if (imageOnly) await expect(stop).toBeVisible()
    await page.screenshot({ path: `test-results/context-${imageOnly ? 'image-only' : 'empty'}-progress.png` })
  } finally {
    if (await stop.isVisible()) await stop.click()
  }
})


test('long side history restores the first-send progress when expanding after reload', async ({ page }) => {
  test.setTimeout(240_000)
  await prepareSeedPage(page)
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'Controlled E2E')
  await main.locator('[data-composer-input]').fill('Initial main progress must survive side history pagination [e2e:hold]')
  await main.locator('[data-composer-input]').press('Enter')
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toBeVisible()
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await send(side, 'Keep this first mainline progress snapshot')
  await main.getByRole('button', { name: /^(Stop generating|停止生成)$/ }).click()
  const toggle = side.locator('[data-sidenote-main-context] > button')
  await toggle.click()
  for (let i = 0; i < 30; i++) await send(side, `Later side discussion ${i}`)
  await side.locator('[data-composer-input]').fill('Keep this draft while context loading fails')
  await page.route('**/api/session/page', async route => {
    if (route.request().postData()?.includes(child)) await route.abort('failed')
    else await route.continue()
  })
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await side.getByRole('button', { name: /^(Retry|重试)$/ }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(side.locator('[data-sidenote-context-section] [role=alert]')).toBeVisible()
  await expect(side.getByRole('button', { name: /^(Retry|重试)$/ })).toHaveCount(1)
  await expect(side.locator('[data-composer-input]')).toHaveText('Keep this draft while context loading fails')
  await page.unroute('**/api/session/page')
  await side.getByRole('button', { name: /^(Retry|重试)$/ }).click()
  await expect(side.locator('[data-sidenote-context-section] [role=alert]')).toHaveCount(0)
  await expect(side.locator('[data-sidenote-context-progress]')).toContainText('Initial main progress must survive side history pagination')
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
  await expect.poll(() => endIsVisible(side.locator('[data-sidenote-context-progress]'))).toBe(true)
})


/** Stress histories must not change the shared seed used by selection and
 * diagnostics journeys later in the same host process. */
async function isolatedMain(page: Page, real = false): Promise<Locator> {
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  await selectModel(page, main, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  await main.locator('[data-composer-input]').fill('Start an isolated full history snapshot. 只回复就绪，不调用工具。')
  await main.locator('[data-composer-input]').press('Enter')
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]')).toHaveCount(1, { timeout: 30_000 })
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 30_000 })
  return main
}

test('delayed context loading yields to newer reader intent and repairs a legacy boundary', async ({ page }) => {
  test.setTimeout(240_000)
  const main = await isolatedMain(page)
  await main.locator('[data-composer-input]').fill('Review snapshot marker [e2e:hold]')
  await main.locator('[data-composer-input]').press('Enter')
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toBeVisible()
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await send(side, 'First side question for delayed history')
  await main.getByRole('button', { name: /^(Stop generating|停止生成)$/ }).click()
  const toggle = side.locator('[data-sidenote-main-context] > button')
  await toggle.click()
  for (let i = 0; i < 30; i++) await send(side, `Audit discussion ${i}`)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let held = false
  await page.route('**/api/session/page', async route => {
    if (!held && route.request().postData()?.includes(child)) {
      held = true
      const response = await route.fetch()
      await gate
      await route.fulfill({ response })
    } else await route.continue()
  })
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect.poll(() => held).toBe(true)
  const last = side.locator('[data-chat-flow-kind="user"]').filter({ hasText: 'Audit discussion 29' })
  await side.locator('[data-composer-input]').fill('I am composing a new message while history is loading')
  const viewport = await side.locator('[data-conversation-scroll]').boundingBox()
  await page.mouse.move(viewport!.x + viewport!.width / 2, viewport!.y + 160)
  await page.mouse.wheel(0, 100000)
  await expect.poll(() => endIsVisible(last)).toBe(true)
  await page.waitForTimeout(350)
  const before = await last.boundingBox()
  await page.screenshot({ path: 'test-results/audit-reader-before.png' })
  release()
  await expect(side.locator('[data-sidenote-context-progress]')).toContainText('Review snapshot marker')
  await page.waitForTimeout(700)
  const after = await last.boundingBox()
  await page.screenshot({ path: 'test-results/audit-reader-after.png' })
  await expect(side.locator('[data-composer-input]')).toHaveText('I am composing a new message while history is loading')
  expect.soft(Math.abs(after!.y - before!.y), 'Loading must not override newer reading intent').toBeLessThan(50)
  await page.unroute('**/api/session/page')
  await toggle.click()
  const staleBoundary = sessionEventsOf(child).at(-1)!.seq
  const oldBoundary = await page.evaluate(({ child, staleBoundary }) => {
    const key = Object.keys(localStorage).find(key => key.startsWith('dsh-sidenote:side-meta:v1:') && JSON.parse(localStorage.getItem(key)!).childId === child)!
    const value = JSON.parse(localStorage.getItem(key)!)
    const old = value.boundarySeq
    localStorage.setItem(key, JSON.stringify({ ...value, boundarySeq: staleBoundary }))
    return old
  }, { child, staleBoundary })
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(side.locator('[data-chat-flow-kind="user"]')).not.toHaveCount(0)
  const closedCount = await side.locator('[data-chat-flow-kind="user"]').count()
  await toggle.click()
  await page.waitForTimeout(1200)
  const restoredBoundary = () => page.evaluate(child => {
    const key = Object.keys(localStorage).find(key => key.startsWith('dsh-sidenote:side-meta:v1:') && JSON.parse(localStorage.getItem(key)!).childId === child)!
    return JSON.parse(localStorage.getItem(key)!).boundarySeq
  }, child)
  await expect.poll(restoredBoundary).toBe(oldBoundary)
  await expect(side.locator('[data-sidenote-context-progress]')).toContainText('Review snapshot marker')
  await page.screenshot({ path: 'test-results/audit-boundary.png' })
  expect.soft(closedCount, 'Own side messages must remain visible while inherited history is collapsed').toBeGreaterThan(0)
})


for (const real of [false, true]) test(`${real ? 'official Flash' : 'native'} first-send snapshot covers a mainline gap beyond the tail page`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires the official DeepSeek lane')
  test.setTimeout(300_000)
  const main = await isolatedMain(page, real)
  const mainId = (await main.getAttribute('data-conversation-session'))!
  const marker = 'EARLY-MAIN-REQUIRED-' + randomUUID()
  await main.locator('[data-composer-input]').fill(real ? `请记住核验码 ${marker}。调用 bash 执行 sleep 45，结束后简短确认。` : `${marker} [e2e:hold]`)
  await main.locator('[data-composer-input]').press('Enter')
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toBeVisible()
  if (real) await expect.poll(() => sessionEventsOf(mainId).some(event => event.type === 'tool/call' && JSON.stringify(event.data).includes('sleep 45')), { timeout: 30_000 }).toBe(true)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await main.getByRole('button', { name: /^(Stop generating|停止生成)$/ }).click()
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  for (let i = 0; i < 30; i++) {
    const before = await main.locator('[data-chat-flow-kind="assistant-step"]').count()
    await main.locator('[data-composer-input]').fill(`Intermediate mainline decision ${i}. 只回复收到，不调用工具。`)
    await main.locator('[data-composer-input]').press('Enter')
    await expect(main.locator('[data-chat-flow-kind="assistant-step"]')).toHaveCount(before + 1, { timeout: 30_000 })
    await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 30_000 })
  }
  const previewBefore = await side.locator('[data-sidenote-context-progress]').textContent()
  expect(previewBefore).toContain(marker)
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/Updates on first send|发送时更新/)
  const sidePrompt = 'FIRST-SEND-AFTER-LONG-MAIN-GAP：请只回复最初主线任务中的完整核验码和编号为 0 的主线决策，不调用工具。'
  await side.locator('[data-composer-input]').fill(sidePrompt)
  await side.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(child).some(text => text.includes(sidePrompt))).toBe(true)
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 60_000 })
  if (real) await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(marker, { timeout: 30_000 })
  const sent = userMessagesOf(child).find(text => text.includes('FIRST-SEND-AFTER-LONG-MAIN-GAP'))!
  const checks = {
    parentStillHasEarly: userMessagesOf(mainId).some(text => text.includes(marker)),
    earlyPresent: sent.includes(marker),
    firstDecisionPresent: sent.includes('Intermediate mainline decision 0'),
    latestDecisionPresent: sent.includes('Intermediate mainline decision 29'),
    decisions: [...sent.matchAll(/Intermediate mainline decision (\d+)/g)].map(m => Number(m[1])),
  }
  expect(checks.parentStillHasEarly).toBe(true)
  expect([...new Set(checks.decisions)]).toEqual(Array.from({ length: 30 }, (_, i) => i))
  await page.screenshot({ path: 'test-results/audit-long-main.png' })
  expect.soft(checks.earlyPresent, 'First-send context must include the start of the un-inherited mainline turn').toBe(true)
  expect.soft(checks.firstDecisionPresent, 'No un-inherited decisions may be lost across a reload').toBe(true)
  expect.soft(checks.latestDecisionPresent).toBe(true)
})
