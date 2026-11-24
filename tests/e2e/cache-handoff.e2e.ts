import { expect, test } from '@playwright/test'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') })
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
      await page.getByRole('option', { name: /^(Reopen|重开)/ }).first().click()
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
