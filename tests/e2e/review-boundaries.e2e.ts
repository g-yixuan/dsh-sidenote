import { expect, test, type Locator } from '@playwright/test'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSeedPage, registerSeedWorkspace, selectModel, sideChatOf, sessionEventsOf, userMessageContentsOf } from './journey'

test.beforeAll(registerSeedWorkspace)
const stop = /^(Stop generating|停止生成)$/
async function send(view: Locator, text: string) {
  await view.locator('[data-composer-input]').fill(text)
  await view.locator('[data-composer-input]').press('Enter')
  await expect(view.getByRole('button', { name: stop })).toHaveCount(0, { timeout: 60_000 })
}

for (const real of [false, true]) test(`${real ? 'official Flash' : 'native'} carries images added after opening the side through save and reload`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires official DeepSeek')
  test.setTimeout(180_000)
  const codes = [0, 1].map(() => 'PIC-' + randomUUID().slice(0, 8).toUpperCase())
  const canvas = await page.context().newPage()
  await canvas.setViewportSize({ width: 500, height: 160 })
  const pictures = []
  for (const code of codes) {
    await canvas.setContent(`<body style="margin:0;background:white;color:black;font:bold 38px monospace;display:grid;place-items:center;height:160px">${code}</body>`)
    pictures.push({ name: `diagram-${pictures.length + 1}.png`, mimeType: 'image/png', buffer: await canvas.screenshot() })
  }
  await canvas.close()
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  await selectModel(page, main, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  await send(main, '请只回复收到，不调用工具。')
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(1)
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  const side = sideChatOf(page)
  await expect(side.locator('[data-composer-input]')).toBeVisible()
  const child = (await side.getAttribute('data-sidenote-chat-session'))!
  for (let index = 0; index < pictures.length; index++) {
    await main.locator('input[type=file]').setInputFiles(pictures[index]!)
    await send(main, index === 0 || !real ? '图片已加入，请只回复收到，不描述图片。' : '')
    await expect(main.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(index + 2)
    await expect(main.getByRole('button', { name: stop })).toHaveCount(0, { timeout: 60_000 })
  }
  await side.locator('[data-sidenote-main-context] > button').click()
  const reader = side.locator('[data-sidenote-context-progress]')
  await expect(reader.locator('img')).toHaveCount(2)
  await expect.poll(() => reader.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  // An identical user-owned image must stay in the local bubble, not be stripped with the carried batch.
  await side.locator('input[type=file]').setInputFiles(pictures[0]!)
  await selectModel(page, side, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  await send(side, '请列出所有可见图片中 PIC- 开头的完整代码，不调用工具。')
  await expect.poll(() => userMessageContentsOf(child).at(-1)?.filter(block => block.type === 'image').length).toBe(3)
  await expect(side.getByRole('button', { name: stop })).toHaveCount(0, { timeout: 60_000 })
  if (real) {
    const reply = side.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])').last()
    for (const code of codes) await expect(reply).toContainText(code, { timeout: 60_000 })
    const wire = JSON.parse(readFileSync(join(process.env.DSH_E2E_HOME!, '..', 'official-wire.json'), 'utf8'))
    expect(wire.at(-1).lastUserImageCount).toBe(3)
  }
  await expect(side.locator('[data-chat-flow-kind="user"] img')).toHaveCount(1)
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(reader.locator('img')).toHaveCount(2)
  await expect.poll(() => reader.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await side.getByRole('button', { name: /^(Save as session|保存为正式会话)$/ }).click()
  await expect(side).toHaveCount(0)
  await page.reload()
  const saved = page.locator('[data-conversation-session]').first()
  await saved.locator('[data-sidenote-main-context] > button').click()
  await expect(saved.locator('[data-sidenote-context-progress] img')).toHaveCount(2)
  await expect.poll(() => saved.locator('[data-sidenote-context-progress] img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await expect(saved.locator('[data-chat-flow-kind="user"] img')).toHaveCount(1)
  await page.screenshot({ path: `test-results/${real ? 'official' : 'native'}-increment-images.png` })
})


for (const real of [false, true]) for (const openBefore of [false, true]) test(`${real ? 'official Flash' : 'native'} keeps the newest checkpoint after saving, retaining an old snapshot, and forking again (open ${openBefore ? 'before' : 'after'} compaction)`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires official DeepSeek')
  test.setTimeout(180_000)
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  await selectModel(page, main, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  await send(main, '项目名是青柠，只回复收到。以下临时材料不需要保留：' + '无关参考材料，不包含任何项目决策。'.repeat(400))
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(1)
  await expect(main.getByRole('button', { name: stop })).toHaveCount(0)
  const mainId = (await main.getAttribute('data-conversation-session'))!
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  await expect(sideChatOf(page).locator('[data-composer-input]')).toBeVisible()
  await main.locator('[data-composer-input]').fill('/compact'); await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => sessionEventsOf(mainId).some(event => event.type === 'compaction/end'), { timeout: 90_000 }).toBe(true)
  const side = sideChatOf(page)
  await selectModel(page, side, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  await send(side, '确认我们现在的项目名，简短回答，不调用工具。')
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(1)
  await expect(side.getByRole('button', { name: stop })).toHaveCount(0)
  await side.getByRole('button', { name: /^(Save as session|保存为正式会话)$/ }).click()
  await expect(side).toHaveCount(0)
  const savedId = (await main.getAttribute('data-conversation-session'))!
  expect(savedId).not.toBe(mainId)
  const before = sessionEventsOf(savedId).at(-1)!.seq
  if (openBefore) {
    await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
    await expect(side.locator('[data-composer-input]')).toBeVisible()
  }
  await send(main, '[e2e:retain-checkpoint] 继续记住项目名，当前阶段是验收；只回复收到，不调用工具。')
  await expect.poll(() => sessionEventsOf(savedId).some(event => event.seq > before && event.type === 'compaction/end' && !event.data.error), { timeout: 90_000 }).toBe(true)
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')).toHaveCount(2)
  await expect(main.getByRole('button', { name: stop })).toHaveCount(0)
  const events = sessionEventsOf(savedId)
  const checkpoint = events.findLast(event => event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint')!
  const oldMarker = events.find(event => event.type === 'user/message' && event.data.content?.some((block: { text?: string }) => block.text?.startsWith('<mainline-progress-snapshot')))!
  const summary = events.find(event => event.seq === checkpoint.seq - 1)!
  expect(summary.data.shadowedSeqs).not.toContain(oldMarker.seq)
  if (!openBefore) await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  await expect(side.locator('[data-composer-input]')).toBeVisible()
  await side.locator('[data-sidenote-main-context] > button').click()
  const rows = side.locator('[data-sidenote-context-progress] [data-context-kind]')
  if (!openBefore) await expect(rows.first()).toHaveAttribute('data-context-key', `${checkpoint.seq}:checkpoint`)
  const checkSummary = async (node: { value?: string; children?: readonly unknown[] }): Promise<void> => {
    if (node.value?.trim()) await expect(rows.first()).toContainText(node.value)
    for (const child of node.children ?? []) await checkSummary(child as typeof node)
  }
  await checkSummary(fromMarkdown(summary.data.summary.map((block: { text?: string }) => block.text ?? '').join('')))
  await expect(side.locator('[data-sidenote-context-progress]')).not.toContainText('<mainline-progress-snapshot')
  await expect(side.locator('[data-sidenote-context-progress] [data-context-kind="checkpoint"]')).toHaveCount(1)
  await selectModel(page, side, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  await send(side, '请说出项目名与当前阶段，不调用工具。')
  const reply = side.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])').last()
  await expect(reply).toBeVisible()
  if (real) { await expect(reply).toContainText('青柠', { timeout: 60_000 }); await expect(reply).toContainText('验收') }
  await expect(side.getByRole('button', { name: stop })).toHaveCount(0)
  await page.reload()
  await checkSummary(fromMarkdown(summary.data.summary.map((block: { text?: string }) => block.text ?? '').join('')))
  await expect(side.locator('[data-sidenote-context-progress]')).not.toContainText('<mainline-progress-snapshot')
  await page.screenshot({ path: `test-results/${real ? 'official' : 'native'}-retained-checkpoint-${openBefore ? 'before' : 'after'}.png` })
})
