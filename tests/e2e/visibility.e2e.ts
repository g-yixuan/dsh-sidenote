import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, sideChatOf, userMessagesOf, openGeneralSettings, selectModel } from './journey'

test.beforeAll(registerSeedWorkspace)

declare global {
  interface Window { __sidenoteListObservations: Array<{ keys: string[]; titled: number }> }
}

async function observeList(page: Page): Promise<number> {
  return page.evaluate(() => {
    window.__sidenoteListObservations = []
    const sample = () => {
      const rows = [...document.querySelectorAll('[role="treeitem"]')]
      const record = {
        keys: rows.map(row => row.getAttribute('data-row-key') ?? ''),
        titled: rows.filter(row => row.textContent?.includes('Side chat plugin review')).length,
      }
      window.__sidenoteListObservations.push(record)
      return record.titled
    }
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-row-key'] })
    return sample()
  })
}

test('side session visibility: creation never flashes, hidden chats run, and a saved copy appears', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await prepareSeedPage(page)
  const forked: string[] = []
  // Hold the response while real host catalog events are free to reach the UI.
  await page.route(/\/api\/[^?]*(?:\/|\.)fork$/, async route => {
    const response = await route.fetch()
    const value = (await response.json()).result?.value
    if (value?.sessionId) forked.push(value.sessionId)
    await new Promise(resolve => setTimeout(resolve, 250))
    await route.fulfill({ response })
  })
  const baseline = await observeList(page)
  const child = await openSideChat(page)
  expect(forked).toContain(child)
  const observations = await page.evaluate(() => window.__sidenoteListObservations)
  expect(observations.length).toBeGreaterThan(1)
  expect(observations.some(frame => frame.keys.includes(`session:${child}`))).toBe(false)
  expect(Math.max(...observations.map(frame => frame.titled))).toBeLessThanOrEqual(baseline)
  const row = page.locator(`[role="treeitem"][data-row-key="session:${child}"]`)
  await expect(row).toHaveCount(0)

  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const replies = side.getByText('Controlled E2E reply. This complete assistant response supports quote selection.', { exact: true })
  const inheritedReplies = await replies.count()
  const message = 'Hidden side session can run before saving a visible copy'
  const input = side.locator('[data-composer-input]')
  await input.fill(message); await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).some(text => text.includes(message)), { timeout: 30_000 }).toBe(true)
  await expect(replies).toHaveCount(inheritedReplies + 1)
  await expect(replies.last()).toBeVisible()
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).some(text => text.includes(message))).toBe(false)
  await expect(row).toHaveCount(0)

  await page.getByRole('button', { name: /^(Search sessions|搜索会话)$/ }).click()
  const search = page.getByPlaceholder(/Search session names|Search sessions|搜索会话/)
  await search.fill('Side chat plugin review')
  await expect(row).toHaveCount(0)
  await page.screenshot({ path: 'test-results/visibility-hidden-search.png' })
  await search.fill('')
  await side.getByRole('button', { name: /^(Save as session|保存为正式会话)$/ }).click()
  await expect(side).toHaveCount(0)
  const saved = forked.at(-1)!
  expect(saved).not.toBe(child)
  expect(userMessagesOf(saved).some(text => text.includes(message))).toBe(true)
  const savedRow = page.locator(`[role="treeitem"][data-row-key="session:${saved}"]`)
  if (await savedRow.count() > 0) await expect(savedRow).toBeVisible()
  else await expect(page.getByRole('treeitem').filter({ hasText: 'Side chat plugin review (1)' })).toBeVisible()
  await expect(page.locator('[data-chat-flow-kind="user"]').filter({ hasText: message })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-chat-flow-kind="user"]').filter({ hasText: message })).toBeVisible()
  await expect(row).toHaveCount(0)
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/visibility-saved-copy.png' })
  writeFileSync('test-results/visibility.json', JSON.stringify({
    child, saved, observedChanges: observations.length, noCreationFlash: true, hiddenModelReply: true, savedCopyVisible: true, reloadRetainsHidden: true,
  }, null, 2) + '\n')
})

test('side session visibility: former show preference cannot reveal children and no setting is offered', async ({ page }) => {
  await prepareSeedPage(page)
  await page.evaluate(() => localStorage.setItem('dsh-sidenote:side-sessions:v1', JSON.stringify({ ids: [], show: true })))
  await page.reload()
  const child = await openSideChat(page)
  await openGeneralSettings(page)
  await expect(page.getByRole('switch', { name: /^(Show side chats in the session list|在会话列表中显示侧边聊天)$/ })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: /^dsh-sidenote (diagnostic mode|诊断模式)$/ })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/settings-without-sidenote-toggles.png' })
  await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
  const row = page.locator(`[role="treeitem"][data-row-key="session:${child}"]`)
  await expect(row).toHaveCount(0)
  await page.reload()
  await expect(sideChatOf(page).locator('[data-composer-input]')).toBeVisible()
  await expect(row).toHaveCount(0)
})
