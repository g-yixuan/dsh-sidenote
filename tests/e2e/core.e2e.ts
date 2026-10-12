import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)

test('shared host journey: real fork, inherited history, accepted side message and session isolation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await prepareSeedPage(page)
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).some(text => text.includes('I forked the main session'))).toBe(true)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  const input = side.getByPlaceholder(/^(Message…|输入消息)/)
  const message = 'Shared host journey: send to this child only'
  await input.fill(message)
  await input.press('Enter')
  // An optimistic bubble or cleared draft alone does not prove admission.
  await expect.poll(() => userMessagesOf(child).some(text => text.includes(message)), { timeout: 30_000 }).toBe(true)
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).some(text => text.includes(message))).toBe(false)
  await expect(input).toHaveValue('')
  await expect(side.getByText(message, { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  writeFileSync('test-results/shared-host-admission.json', JSON.stringify({
    parent: process.env.DSH_E2E_SEED_SESSION,
    child,
    acceptedText: userMessagesOf(child).find(text => text.includes(message)),
    parentReceived: false,
  }, null, 2) + '\n')
  await page.screenshot({ path: 'test-results/shared-host-journey.png' })
})
