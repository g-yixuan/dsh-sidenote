import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') })
})

for (const real of [false, true]) test(`${real ? 'official Flash' : 'native'} first send preserves the latest mainline cache prefix`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires the official DeepSeek lane')
  test.setTimeout(180_000)
  await prepareSeedPage(page)
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${mainId}"]`)
  const model = real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E'
  await selectModel(page, main, model)
  const originalChild = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, model)
  const marker = 'CACHE-' + randomUUID()
  const history = Array.from({ length: real ? 192 : 8 }, (_, index) => `资料 ${index}：系统用稳定的原始消息保存主线任务和工具结果，侧边提问继承相同前缀。`).join('\n')
  const prompt = `请记住以下资料。不要调用工具，只回复 ${marker}。\n${history}`
  await main.locator('[data-composer-input]').fill(prompt)
  await main.locator('[data-composer-input]').press('Enter')
  const stop = /^(Stop generating|停止生成)$/
  await expect.poll(() => userMessagesOf(mainId).includes(prompt)).toBe(true)
  await expect.poll(() => sessionEventsOf(mainId).at(-1)?.type === 'turn/end', { timeout: 90_000 }).toBe(true)
  await expect(main.getByRole('button', { name: stop })).toHaveCount(0)
  const mainBefore = userMessagesOf(mainId)
  const question = `不要调用工具，只回复 ${marker} 的最后六个字符。`
  const input = side.locator('[data-composer-input]')
  await input.fill(question); await input.press('Enter')
  await expect(side).not.toHaveAttribute('data-sidenote-chat-session', originalChild)
  const child = (await side.getAttribute('data-sidenote-chat-session'))!
  await expect.poll(() => userMessagesOf(child).some(text => text.endsWith(question))).toBe(true)
  await expect.poll(() => sessionEventsOf(child).at(-1)?.type === 'turn/end', { timeout: 90_000 }).toBe(true)
  const events = sessionEventsOf(child)
  const seed = events.findLast(event => event.type === 'session/end-seed' && event.data.inherited)!
  expect(events.filter(event => event.seq < seed.seq)).toEqual(sessionEventsOf(mainId).filter(event => event.seq < seed.seq))
  const sent = userMessagesOf(child).find(text => text.endsWith(question))!
  expect(sent).toContain('<mainline-progress-snapshot')
  expect(sent).not.toContain(history)
  expect(userMessagesOf(originalChild).some(text => text.includes(marker))).toBe(false)
  expect(userMessagesOf(mainId)).toEqual(mainBefore)
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
  const later = '不要调用工具，只回复：侧聊第二轮完成。'
  await input.fill(later); await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).includes(later)).toBe(true)
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect.poll(() => sessionEventsOf(child).at(-1)?.type === 'turn/end', { timeout: 90_000 }).toBe(true)
  await page.reload()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(sideChatOf(page).locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
  if (real) {
    const path = join(process.env.DSH_E2E_HOME!, '..', 'official-wire.json')
    const wire = () => JSON.parse(readFileSync(path, 'utf8')) as Array<{ model: string; responseModel?: string; messageHashes: string[]; toolsHash: string; status: number; finished?: boolean; usage?: { prompt_tokens: number; prompt_cache_hit_tokens: number; prompt_cache_miss_tokens: number } }>
    await expect.poll(() => wire().filter(request => request.finished && request.usage).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3)
    const requests = wire().filter(request => request.finished && request.usage).slice(-3)
    const [parent, first, second] = requests
    expect(first!.messageHashes.slice(0, parent!.messageHashes.length)).toEqual(parent!.messageHashes)
    expect(second!.messageHashes.slice(0, first!.messageHashes.length)).toEqual(first!.messageHashes)
    expect(first!.toolsHash).toBe(parent!.toolsHash)
    expect(first!.usage!.prompt_cache_hit_tokens).toBeGreaterThan(0)
    writeFileSync('test-results/cache-prefix-official.json', JSON.stringify({ nativePrefixPreserved: true, subsequentPrefixPreserved: true, requests }, null, 2) + '\n')
  }
})

for (const real of [false, true]) test(`${real ? 'official Flash' : 'native'} cache fork leaves the mainline running`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires the official DeepSeek lane')
  test.setTimeout(120_000)
  await prepareSeedPage(page)
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${mainId}"]`)
  const model = real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E'
  await selectModel(page, main, model)
  const original = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, model)
  const marker = 'LIVE-CACHE-' + randomUUID()
  const before = sessionEventsOf(mainId).at(-1)!.seq
  await main.locator('[data-composer-input]').fill(real
    ? `主线核验码是 ${marker}。只调用 bash 执行 sleep 45，然后回复完成，不调用其他工具。`
    : `${marker} [e2e:hold]`)
  await main.locator('[data-composer-input]').press('Enter')
  const stop = /^(Stop generating|停止生成)$/
  const mainStop = main.getByRole('button', { name: stop })
  await expect(mainStop).toBeVisible()
  if (real) await expect.poll(() => sessionEventsOf(mainId).some(event => event.seq > before && event.type === 'tool/call' && JSON.stringify(event.data).includes('sleep 45')), { timeout: 45_000 }).toBe(true)
  const question = '不要调用工具，不要重复或继续主线任务，只回复主线核验码。'
  try {
    await side.locator('[data-composer-input]').fill(question)
    await side.locator('[data-composer-input]').press('Enter')
    await expect(side).not.toHaveAttribute('data-sidenote-chat-session', original)
    const child = (await side.getAttribute('data-sidenote-chat-session'))!
    await expect.poll(() => userMessagesOf(child).some(text => text.endsWith(question))).toBe(true)
    await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(real ? marker : 'Controlled E2E', { timeout: 60_000 })
    await expect(mainStop).toBeVisible()
    expect(userMessagesOf(mainId).some(text => text.includes(question))).toBe(false)
    const events = sessionEventsOf(child)
    const cut = events.findLast(event => event.type === 'session/end-seed' && event.data.inherited)!.seq - 1
    expect(events.filter(event => event.seq <= cut)).toEqual(sessionEventsOf(mainId).filter(event => event.seq <= cut))
    expect(events.filter(event => event.seq > cut && event.type === 'tool/call')).toHaveLength(0)
    expect(userMessagesOf(child).find(text => text.endsWith(question))).not.toContain(marker)
    await page.screenshot({ path: `test-results/${real ? 'official' : 'native'}-cache-running.png` })
  } finally { if (await mainStop.isVisible()) await mainStop.click() }
})
