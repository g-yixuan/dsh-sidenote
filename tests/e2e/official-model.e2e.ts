import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, sessionEventsOf, sideChatOf, userMessagesOf, selectModel, userMessageContentsOf } from './journey'

test.skip(!process.env.DSH_E2E_REAL_MODEL, 'Set DSH_E2E_REAL_KEY_FILE for the official DeepSeek lane')
test.beforeAll(registerSeedWorkspace)

test('official Flash executes real file tools in main and side, with isolated multi-turn replies', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const mainMarker = 'MAIN-' + randomUUID()
  const sideMarker = 'SIDE-' + randomUUID()
  writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, 'official-main.txt'), mainMarker + '\n')
  writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, 'official-side.txt'), sideMarker + '\n')
  try { await prepareSeedPage(page) } catch (error) { throw new Error(`${String(error)}\nPage errors: ${errors.join('\n')}`) }
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'DeepSeek Flash (official E2E)')
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const baselineMain = sessionEventsOf(mainId).at(-1)!.seq
  await main.locator('[data-composer-input]').fill('使用 read 工具读取当前工作区 official-main.txt，只回复文件内的标记。不要猜测，不要运行其他命令。')
  await main.locator('[data-composer-input]').press('Enter')
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: mainMarker })).toBeVisible({ timeout: 90_000 })
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 30_000 })
  const mainTools = sessionEventsOf(mainId).filter(event => event.seq > baselineMain && event.type === 'tool/result')
  expect(mainTools.some(event => JSON.stringify(event.data).includes(mainMarker))).toBe(true)

  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'DeepSeek Flash (official E2E)')
  const baselineSide = sessionEventsOf(child).at(-1)!.seq
  const mainBefore = userMessagesOf(mainId)
  const input = side.locator('[data-composer-input]')
  const prompt = '使用 read 工具读取当前工作区 official-side.txt，只回复文件内的标记。不要猜测，不要运行其他命令。'
  await input.fill(prompt); await input.press('Enter')
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toBeVisible()
  const queued = '不要再调用工具，只回复：官方排队验证通过'
  await input.fill(queued)
  await side.getByRole('button', { name: /^(Queue message|加入队列|排队发送)$/ }).click()
  await expect(input).toHaveText('')
  await expect(side.getByText(queued, { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/official-queue.png' })
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: sideMarker })).toBeVisible({ timeout: 90_000 })
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: '官方排队验证通过' })).toBeVisible({ timeout: 90_000 })
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 30_000 })
  const sideTools = sessionEventsOf(child).filter(event => event.seq > baselineSide && event.type === 'tool/result')
  expect(sideTools.some(event => JSON.stringify(event.data).includes(sideMarker))).toBe(true)
  expect(userMessagesOf(child).filter(text => text === queued)).toHaveLength(1)
  expect(userMessagesOf(mainId)).toEqual(mainBefore)
  await input.fill('不要再调用工具，只回复：官方多轮验证通过'); await input.press('Enter')
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: '官方多轮验证通过' })).toBeVisible({ timeout: 60_000 })
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  await side.getByRole('button', { name: /^(Select model|选择模型)/ }).click()
  await page.getByRole('menuitem', { name: /^(Effort |推理等级)/ }).click()
  await page.getByRole('menuitemradio', { name: /^Low$/i }).click()
  await expect(side.getByRole('button', { name: /^(Select model|选择模型)/ })).toHaveAttribute('aria-label', /Low/i)
  const beforeThinking = sessionEventsOf(child).at(-1)!.seq
  await input.fill('不要调用工具，计算 23 加 19，只回复计算结果。'); await input.press('Enter')
  await expect.poll(() => sessionEventsOf(child).some(event => event.seq > beforeThinking && event.type === 'turn/end' && event.data.reason.kind === 'completed'), { timeout: 60_000 }).toBe(true)
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: '42' }).last()).toBeVisible({ timeout: 60_000 })
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  const wireFile = join(process.env.DSH_E2E_HOME!, '..', 'official-wire.json')
  const wire = () => JSON.parse(readFileSync(wireFile, 'utf8')) as Array<{ thinking: { type: string } | null; reasoningEffort: string | null; status: number; finished?: boolean }>
  await expect.poll(() => wire().some(request => request.thinking?.type === 'enabled' && request.reasoningEffort === 'low' && request.status === 200 && request.finished)).toBe(true)
  const beforeImage = sessionEventsOf(child).at(-1)!.seq
  await side.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
  await input.fill('不要调用工具，简短描述上传图片的主要颜色。'); await input.press('Enter')
  await expect.poll(() => userMessageContentsOf(child).at(-1)?.some(block => block.type === 'image')).toBe(true)
  await expect.poll(() => sessionEventsOf(child).some(event => event.seq > beforeImage && event.type === 'turn/end' && event.data.reason.kind === 'completed'), { timeout: 60_000 }).toBe(true)
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 60_000 })
  await expect(side.locator('[data-chat-flow-kind="user"] img').last()).toBeVisible()
  expect(errors).toEqual([])
  writeFileSync('test-results/official-wire.json', readFileSync(wireFile))
  writeFileSync('test-results/official-model.json', JSON.stringify({ provider: 'https://api.deepseek.com', model: 'deepseek-flash', main: mainId, child, mainToolResults: mainTools.length, sideToolResults: sideTools.length, mainIsolated: true, busyQueueOnce: true, multiTurn: true, reasoningLow: true, image: true }, null, 2) + '\n')
  await page.screenshot({ path: 'test-results/official-model.png' })
})
