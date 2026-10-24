import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: `test-results/interaction-${info.title.split(':')[0]}.png` })
  if (info.status !== info.expectedStatus) writeFileSync(`test-results/interaction-${info.title.split(':')[0]}.yml`, await page.locator('body').ariaSnapshot())
})

test('question: answer the actual host tool question in the native side conversation', async ({ page }) => {
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const input = side.locator('[data-composer-input]')
  await input.fill('native question integration [e2e:question]'); await input.press('Enter')
  await expect(side.getByText('Which native layout should we use?', { exact: true })).toBeVisible()
  await side.getByRole('radio', { name: 'Compact', exact: true }).check()
  await side.getByRole('button', { name: /^(Submit|提交|Send answers|提交答案)$/ }).click()
  await expect.poll(() => sessionEventsOf(child).filter(event => event.type === 'tool/result').some(event => JSON.stringify(event.data).includes('Compact'))).toBe(true)
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
})

test('approval: an outside-workspace write waits for approval and executes once', async ({ page }) => {
  const file = join(process.env.DSH_E2E_WORKSPACE!, '..', 'approval-target.txt')
  expect(existsSync(file)).toBe(false)
  await prepareSeedPage(page)
  await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const input = side.locator('[data-composer-input]')
  await input.fill('bounded approval integration [e2e:approval]'); await input.press('Enter')
  const allow = side.getByRole('button', { name: /^(Allow once|Allow this time|允许一次|仅本次允许)$/ })
  await expect(allow).toBeVisible()
  expect(existsSync(file)).toBe(false)
  await allow.click()
  await expect.poll(() => existsSync(file)).toBe(true)
  expect(readFileSync(file, 'utf8')).toBe('approved native side tool\n')
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
})

test('tool-output: the native read card preserves content after the old 4000-character limit', async ({ page }) => {
  writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, 'long-tool.txt'), Array.from({ length: 100 }, (_, i) => `Line ${i}: ` + 'A'.repeat(64)).join('\n') + '\nNATIVE-LONG-TOOL-END\n')
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const input = side.locator('[data-composer-input]')
  await input.fill('long tool integration [e2e:long-tool]'); await input.press('Enter')
  await expect.poll(() => sessionEventsOf(child).filter(event => event.type === 'tool/result').some(event => JSON.stringify(event.data).includes('NATIVE-LONG-TOOL-END'))).toBe(true)
  const result = sessionEventsOf(child).find(event => event.type === 'tool/result' && JSON.stringify(event.data).includes('NATIVE-LONG-TOOL-END'))!
  expect(JSON.stringify(result.data).indexOf('NATIVE-LONG-TOOL-END')).toBeGreaterThan(4000)
  const completed = side.locator(`button[data-turn-process="${result.data.turn}"]`)
  await expect(completed).toHaveAttribute('data-turn-process-tool-calls', /^[1-9]\d*$/)
  await expect(completed).toBeEnabled()
  await completed.click()
  await side.getByRole('button', { name: /^(Read files|读取了文件)$/ }).click()
  await side.getByRole('button', { name: /Read.*long-tool\.txt/ }).click()
  await expect(side.getByText(/NATIVE-LONG-TOOL-END/)).toBeVisible()
})
