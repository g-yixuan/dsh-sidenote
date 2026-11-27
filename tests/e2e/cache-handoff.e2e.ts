import { expect, test } from '@playwright/test'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') })
})

test('cache handoff keeps accepted context when closed before acknowledgement', async ({ page }) => {
  await prepareSeedPage(page)
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${mainId}"]`)
  await selectModel(page, main, 'Controlled E2E')
  const original = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const update = `CLOSE-AFTER-SUBMIT-${Date.now()}`
  await main.locator('[data-composer-input]').fill(update)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(mainId).includes(update) && sessionEventsOf(mainId).at(-1)?.type === 'turn/end').toBe(true)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/session/prompt', async route => { await gate; await route.continue() })
  const request = page.waitForRequest('**/api/session/prompt')
  const question = `Keep this accepted side question: ${update}`
  try {
    await side.locator('[data-composer-input]').fill(question)
    await side.locator('[data-composer-input]').press('Enter')
    await request
    const child = (await side.getAttribute('data-sidenote-chat-session'))!
    expect(child).not.toBe(original)
    const id = await side.locator('xpath=ancestor::*[@data-sidebar-right-tab][1]').getAttribute('data-sidebar-right-tab')
    const tab = page.getByRole('tab').filter({ has: page.locator(`[data-sidebar-right-tab="${id}"]`) })
    await tab.hover(); await tab.getByRole('button', { name: /^(Close|关闭)$/ }).click()
    await expect(side).toHaveCount(0)
    release()
    await expect.poll(() => userMessagesOf(child).filter(text => text.endsWith(question)).length).toBe(1)
    await main.locator('[data-composer-input]').fill('/side')
    await page.getByRole('option', { name: /^side /i }).click()
    await page.getByRole('button', { name: /^(Reopen|重开)/ }).first().click()
    await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
    await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
    await expect.poll(() => sessionEventsOf(child).at(-1)?.type === 'turn/end').toBe(true)
    const followup = `Ordinary followup after reopen: ${update}`
    await side.locator('[data-composer-input]').fill(followup)
    await side.locator('[data-composer-input]').press('Enter')
    await expect.poll(() => userMessagesOf(child).includes(followup)).toBe(true)
    expect(userMessagesOf(mainId).some(text => text.includes(question) || text.includes(followup))).toBe(false)
  } finally { release(); await page.unroute('**/api/session/prompt') }
})

for (const reopen of [false, true]) test(`cache handoff retries a rejected first send with fresh context (reopen=${reopen})`, async ({ page }) => {
  await prepareSeedPage(page)
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${mainId}"]`)
  await selectModel(page, main, 'Controlled E2E')
  const original = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const before = `REJECT-BEFORE-${reopen}-${Date.now()}`
  await main.locator('[data-composer-input]').fill(before)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(mainId).includes(before) && sessionEventsOf(mainId).at(-1)?.type === 'turn/end').toBe(true)
  const question = `Retry the complete side question exactly once: ${before}`
  await page.route('**/api/session/prompt', route => route.abort('failed'))
  try {
    await side.locator('[data-composer-input]').fill(question)
    await side.locator('[data-composer-input]').press('Enter')
    await expect(side).not.toHaveAttribute('data-sidenote-chat-session', original)
    await expect(side.getByRole('alert')).toBeVisible()
    await expect(side.locator('[data-composer-input]')).toHaveText(question)
  } finally { await page.unroute('**/api/session/prompt') }
  const rejected = (await side.getAttribute('data-sidenote-chat-session'))!
  expect(userMessagesOf(rejected).some(text => text.endsWith(question))).toBe(false)
  if (reopen) {
    const id = await side.locator('xpath=ancestor::*[@data-sidebar-right-tab][1]').getAttribute('data-sidebar-right-tab')
    const tab = page.getByRole('tab').filter({ has: page.locator(`[data-sidebar-right-tab="${id}"]`) })
    await tab.hover(); await tab.getByRole('button', { name: /^(Close|关闭)$/ }).click()
    await expect(side).toHaveCount(0)
    await main.locator('[data-composer-input]').fill('/side')
    await page.getByRole('option', { name: /^side /i }).click()
    await page.getByRole('button', { name: /^(Reopen|重开)/ }).first().click()
    await expect(side).toHaveAttribute('data-sidenote-chat-session', rejected)
    await expect(side.locator('[data-composer-input]')).toHaveText(question)
  }
  const latest = `REJECT-AFTER-${reopen}-${Date.now()}`
  await main.locator('[data-composer-input]').fill(latest)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(mainId).includes(latest) && sessionEventsOf(mainId).at(-1)?.type === 'turn/end').toBe(true)
  await side.locator('[data-composer-input]').press('Enter')
  await expect.poll(async () => userMessagesOf((await side.getAttribute('data-sidenote-chat-session'))!).filter(text => text.endsWith(question)).length).toBe(1)
  const accepted = (await side.getAttribute('data-sidenote-chat-session'))!
  expect(userMessagesOf(accepted)).toContain(latest)
  const sent = userMessagesOf(accepted).find(text => text.endsWith(question))!
  expect(sent.match(/<mainline-progress-snapshot /g)).toHaveLength(1)
  expect(userMessagesOf(mainId).some(text => text.endsWith(question))).toBe(false)
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', accepted)
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
})

test('cache handoff keeps the side permission when the parent changes access mode', async ({ page }) => {
  await prepareSeedPage(page)
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${mainId}"]`)
  await selectModel(page, main, 'Controlled E2E')
  const access = /^(Access mode, current:|访问模式，当前：)/
  await main.getByRole('button', { name: access }).click()
  await page.getByRole('menuitem', { name: /Read.only|只读/i }).click()
  await expect(main.getByRole('button', { name: access })).toHaveAccessibleName(/Read.only|只读/i)
  const original = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  await expect(side.getByRole('button', { name: access })).toHaveAccessibleName(/Read.only|只读/i)
  await main.getByRole('button', { name: access }).click()
  await page.getByRole('menuitem', { name: /Workspace Write|工作区内修改/ }).click()
  const update = 'Parent update after changing permission; do not call tools.'
  await main.locator('[data-composer-input]').fill(update)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(mainId).includes(update) && sessionEventsOf(mainId).at(-1)?.type === 'turn/end').toBe(true)
  const question = 'Keep my side chat read-only; answer without tools.'
  await side.locator('[data-composer-input]').fill(question)
  await side.locator('[data-composer-input]').press('Enter')
  await expect.poll(async () => userMessagesOf((await side.getAttribute('data-sidenote-chat-session'))!).some(text => text.endsWith(question))).toBe(true)
  await expect(side.getByRole('button', { name: access })).toHaveAccessibleName(/Read.only|只读/i)
  await expect(side).toHaveAttribute('data-sidenote-chat-session', original)
})

for (const failure of ['storage', 'closed']) test(`cache handoff preserves the draft without sending after ${failure}`, async ({ page }) => {
  await prepareSeedPage(page)
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${mainId}"]`)
  await selectModel(page, main, 'Controlled E2E')
  const original = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const tabId = await side.locator('xpath=ancestor::*[@data-sidebar-right-tab][1]').getAttribute('data-sidebar-right-tab')
  const update = `New mainline context for ${failure} handoff`
  await main.locator('[data-composer-input]').fill(update)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(mainId).includes(update) && sessionEventsOf(mainId).at(-1)?.type === 'turn/end').toBe(true)
  let release: (() => void) | undefined
  let candidate: string | undefined
  const archived: string[] = []
  page.on('response', async response => {
    if (!response.url().endsWith('/api/workspace/archiveSession')) return
    if ((await response.json()).result?.ok) archived.push(response.request().postDataJSON().payload.args.request.sessionId)
  })
  await page.route('**/api/session/fork', async route => {
    const response = await route.fetch()
    const body = await response.json()
    candidate = body.result.value.sessionId
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ response })
  })
  const question = `Retain this ${failure} question exactly once`
  try {
    await side.locator('[data-composer-input]').fill(question)
    await side.locator('[data-composer-input]').press('Enter')
    await expect.poll(() => !!release).toBe(true)
    expect(candidate).toBeTruthy()
    if (failure === 'storage') await page.evaluate(() => {
      const originalSet = Storage.prototype.setItem
      Object.assign(window, { restoreCacheStorage: () => { Storage.prototype.setItem = originalSet } })
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('dsh-sidenote:side-meta:v1:')) throw new DOMException('E2E storage failure', 'QuotaExceededError')
        originalSet.call(this, key, value)
      }
    })
    else {
      const tab = page.getByRole('tab').filter({ has: page.locator(`[data-sidebar-right-tab="${tabId}"]`) })
      await tab.hover()
      await tab.getByRole('button', { name: /^(Close|关闭)$/ }).click()
      await expect(side).toHaveCount(0)
    }
    release!()
    await expect.poll(() => archived.includes(candidate!)).toBe(true)
    expect(userMessagesOf(candidate!).some(text => text.includes(question))).toBe(false)
    expect(userMessagesOf(original).some(text => text.includes(question))).toBe(false)
    if (failure === 'closed') {
      await main.locator('[data-composer-input]').fill('/side')
      await page.getByRole('option', { name: /^side /i }).click()
      await page.getByRole('button', { name: /^(Reopen|重开)/ }).first().click()
    }
    await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', original)
    await expect(sideChatOf(page).locator('[data-composer-input]')).toHaveText(question)
    if (failure === 'storage') await expect(sideChatOf(page)).toContainText('无法保存侧聊切换')
  } finally {
    release?.()
    await page.unroute('**/api/session/fork')
    await page.evaluate(() => (window as unknown as { restoreCacheStorage?: () => void }).restoreCacheStorage?.())
  }
  await sideChatOf(page).locator('[data-composer-input]').press('Enter')
  await expect(sideChatOf(page)).not.toHaveAttribute('data-sidenote-chat-session', original)
  const recovered = (await sideChatOf(page).getAttribute('data-sidenote-chat-session'))!
  await expect.poll(() => userMessagesOf(recovered).filter(text => text.endsWith(question)).length).toBe(1)
  await page.reload()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', recovered)
})
