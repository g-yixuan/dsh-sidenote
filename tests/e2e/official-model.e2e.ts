import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, sessionEventsOf, sideChatOf, userMessagesOf, selectModel, userMessageContentsOf, openGeneralSettings } from './journey'

test.skip(!process.env.DSH_E2E_REAL_MODEL, 'Set DSH_E2E_REAL_KEY_FILE for the official DeepSeek lane')
test.beforeAll(registerSeedWorkspace)

test('official Flash UI regressions: live context, empty annotation send and inline reflow', async ({ page }) => {
  test.setTimeout(240_000)
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const marker = 'UI-' + randomUUID()
  writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, 'ui-main.txt'), marker + '\n')
  await prepareSeedPage(page)
  const main = page.locator('[data-conversation-session]').first()
  await selectModel(page, main, 'DeepSeek Flash (official E2E)')
  const before = sessionEventsOf(mainId).at(-1)!.seq
  await main.locator('[data-composer-input]').fill('使用 bash 工具执行 sleep 15; cat ui-main.txt，等待命令完成后只回复文件中的标记。只调用这一次工具。')
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => sessionEventsOf(mainId).some(event => event.seq > before && event.type === 'tool/call' && JSON.stringify(event.data).includes('sleep 15')), { timeout: 60_000 }).toBe(true)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  const context = side.locator('[data-sidenote-main-context]')
  await expect(context).toContainText(/Updates on first send|发送时更新/)
  await expect(context).toContainText('ui-main.txt')
  await context.getByRole('button').click()
  const input = side.locator('[data-composer-input]')
  expect((await input.boundingBox())!.y).toBeGreaterThan((await side.boundingBox())!.y + (await side.boundingBox())!.height * 0.65)
  await page.screenshot({ path: 'test-results/official-context-before-send.png' })
  await selectModel(page, side, 'DeepSeek Flash (official E2E)')

  const quote = main.locator('[data-chat-flow-kind="assistant-step"] li').filter({ hasText: 'full history snapshot' }).first()
  await quote.scrollIntoViewIfNeeded()
  const box = await quote.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf('full history snapshot')
      if (at < 0) continue
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 'full history snapshot'.length)
      const rect = range.getBoundingClientRect()
      return { x: rect.left, y: rect.top + rect.height / 2, width: rect.width }
    }
    throw new Error('Seed quote missing')
  })
  await page.mouse.move(box.x + 0.1, box.y); await page.mouse.down(); await page.mouse.move(box.x + box.width - 0.1, box.y, { steps: 10 }); await page.mouse.up()
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText(/^(Ask in side chat|在侧边聊天中提问)$/).click()
  await overlay.locator('input').fill('不要调用工具，只回复：批注直发验证通过')
  await overlay.locator('input').press('Enter')
  await expect(input).toHaveText('')
  await expect(side.getByRole('button', { name: /^(Send annotations|发送注释)$/ })).toHaveCount(0)
  const send = side.getByRole('button', { name: /^(Send message|发送消息)$/ })
  await expect(send).toBeEnabled()
  await send.click()
  await expect.poll(() => userMessagesOf(child).some(text => text.includes('<note>不要调用工具，只回复：批注直发验证通过</note>'))).toBe(true)
  await expect(context).toContainText(/As of|截至/)
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: '批注直发验证通过' }).last()).toBeVisible({ timeout: 90_000 })
  const returnButton = side.getByRole('button', { name: /^(Bring back to main conversation|带回主对话)$/ }).last()
  await expect(returnButton).toBeVisible()
  expect(await returnButton.evaluate(button => button.closest('[data-clock="end"]') !== null)).toBe(true)
  await returnButton.click()
  await expect(main.getByRole('button', { name: /1 side-chat reflow|1 条侧边回流/ })).toBeVisible()
  await expect(side.getByRole('button', { name: /Added to main conversation, not sent yet|已加入主对话，尚未发送/ })).toBeDisabled()
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: marker })).toBeVisible({ timeout: 90_000 })
  expect(userMessagesOf(mainId).some(text => text.includes('批注直发验证通过'))).toBe(false)
  await expect(side.locator('[class$="_bubble"] [data-dsh-sidenote-bubble]')).toBeVisible()

  const returnPrompt = '只复述刚才从侧边带回的回答，不调用工具。'
  await main.locator('[data-composer-input]').fill(returnPrompt)
  await main.locator('[data-composer-input]').press('Enter')
  const returnedBubble = main.locator('[data-chat-flow-kind="user"] [class$="_bubble"]').filter({ hasText: returnPrompt })
  const returnChip = returnedBubble.getByRole('button', { name: /Side-chat context|含侧边回流上下文/ })
  await expect(returnChip).toBeVisible()
  await returnChip.click()
  await expect(returnedBubble).toContainText('批注直发验证通过')
  await returnChip.click()
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: '批注直发验证通过' }).last()).toBeVisible({ timeout: 90_000 })
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  expect(userMessagesOf(mainId).at(-1)).toBe(returnPrompt)

  await openGeneralSettings(page)
  const settings = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
  await settings.getByRole('button', { name: /^(English|中文)$/ }).click()
  await page.getByRole('menuitem', { name: '中文', exact: true }).click()
  await settings.getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
  await page.screenshot({ path: 'test-results/official-ui-regressions.png' })
  await openGeneralSettings(page)
  await settings.getByRole('button', { name: '中文', exact: true }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await settings.getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
  writeFileSync('test-results/official-ui-regressions.json', JSON.stringify({ model: 'deepseek-flash', liveContextBeforeSend: true, bottomComposer: true, annotationOnlySend: true, inlineReflow: true, bubbleContext: true, injectedReflowBubble: true, isolated: true }, null, 2) + '\n')
})

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
