import { expect, test, type Locator } from '@playwright/test'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

// Context now renders Markdown. Check every source text leaf instead of
// requiring visible heading/list delimiters that should disappear on rendering.
async function expectMarkdownContent(row: Locator, markdown: string): Promise<void> {
  const visit = async (node: { value?: string; children?: readonly unknown[] }): Promise<void> => {
    if (node.value?.trim()) await expect(row).toContainText(node.value)
    for (const child of node.children ?? []) await visit(child as typeof node)
  }
  await visit(fromMarkdown(markdown))
}

test.beforeAll(registerSeedWorkspace)
test('native side send during standalone compaction does not inherit its lock or defer the first snapshot', async ({ page }) => {
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  await selectModel(page, main, 'Controlled E2E')
  const input = main.locator('[data-composer-input]')
  await input.fill('[e2e:slow-compact]\n' + 'Temporary raw history for compaction.\n'.repeat(180)); await input.press('Enter')
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]')).toHaveCount(1)
  await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  const mainId = (await main.getAttribute('data-conversation-session'))!
  await input.fill('/compact'); await input.press('Enter')
  await expect.poll(() => sessionEventsOf(mainId).some(event => event.type === 'compaction/start')).toBe(true)
  expect(sessionEventsOf(mainId).some(event => event.type === 'compaction/end')).toBe(false)
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  const side = sideChatOf(page)
  await expect(side.locator('[data-composer-input]')).toBeVisible()
  const child = (await side.getAttribute('data-sidenote-chat-session'))!
  expect(sessionEventsOf(child).some(event => event.type === 'compaction/start')).toBe(false)
  expect(sessionEventsOf(child).some(event => event.type === 'command/run' && event.data.name === 'compact')).toBe(false)
  await side.locator('[data-composer-input]').fill('Side reply while the main compact transaction is pending')
  await side.locator('[data-composer-input]').press('Enter')
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]')).toBeVisible()
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
  await expect.poll(() => sessionEventsOf(mainId).some(event => event.type === 'compaction/end'), { timeout: 30_000 }).toBe(true)
  await side.locator('[data-composer-input]').fill('Second side question after the main compaction finishes')
  await side.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('Second side question'))).toHaveLength(1)
  expect(userMessagesOf(child).find(text => text.includes('Second side question'))).not.toContain('<mainline-progress-snapshot')
})

for (const real of [false, true]) for (const busy of [false, true]) test(`${real ? 'official Flash' : 'native'} side context starts at the latest of two compactions and retains its recent tail (${busy ? 'running' : 'idle'})`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires the official DeepSeek lane')
  test.setTimeout(240_000)
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  const input = main.locator('[data-composer-input]')
  await selectModel(page, main, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  const marker = 'COMPACT-' + randomUUID()
  let mainId = ''
  const rawInputs: string[] = []
  for (let i = 0; i < 2; i++) {
    const message = `请牢记项目核验码 ${marker}，当前阶段是第 ${i + 1} 阶段。不要调用工具，只简短确认核验码和阶段。以下是不用保留的占位参考材料：\n` + `临时参考 ${i}：此段不包含项目决策，压缩时请省略。\n`.repeat(180)
    rawInputs.push(message)
    await input.fill(message); await input.press('Enter')
    await expect(main.locator('[data-chat-flow-kind="assistant-step"]')).toHaveCount(i + 1, { timeout: 60_000 })
    await expect(main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0, { timeout: 60_000 })
    mainId = (await main.getAttribute('data-conversation-session'))!
    const before = sessionEventsOf(mainId).at(-1)!.seq
    await input.fill('/compact'); await input.press('Enter')
    await expect.poll(() => sessionEventsOf(mainId).some(event => event.seq > before && event.type === 'compaction/end'), { timeout: 90_000 }).toBe(true)
    expect(sessionEventsOf(mainId).findLast(event => event.type === 'compaction/end')!.data.error).toBeUndefined()
  }
  const events = sessionEventsOf(mainId)
  const checkpoints = events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint')
  expect(checkpoints).toHaveLength(2)
  const checkpoint = checkpoints.at(-1)!
  const summary = events.find(event => event.seq === checkpoint.seq - 1)!.data.summary.map((block: { text?: string }) => block.text ?? '').join('')
  const retained = events.filter(event => event.seq < checkpoint.seq && event.type === 'assistant/message').at(-1)!.data.message.content.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('')
  const mainStop = main.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  if (busy) {
    await input.fill(real ? '保持现有项目代号和阶段不变；调用 bash 执行 sleep 60，结束后简短确认。' : 'Continue after compaction [e2e:hold]')
    await input.press('Enter')
    await expect(mainStop).toBeVisible()
    if (real) await expect.poll(() => sessionEventsOf(mainId).some(event => event.seq > checkpoint.seq && event.type === 'tool/call' && JSON.stringify(event.data).includes('sleep 60')), { timeout: 60_000 }).toBe(true)
  }
  // Open immediately after standalone compaction: the native fork must include
  // that checkpoint even though it is newer than the last turn/end.
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  const side = sideChatOf(page)
  await expect(side.locator('[data-composer-input]')).toBeVisible()
  const child = (await side.getAttribute('data-sidenote-chat-session'))!
  expect(sessionEventsOf(child).some(event => event.seq === checkpoint.seq && event.type === 'user/message' && event.data.source?.kind === 'compact-checkpoint')).toBe(true)
  const context = side.locator('[data-sidenote-main-context]')
  await context.locator(':scope > button').click()
  const entries = side.locator('[data-sidenote-context-progress] [data-context-kind]')
  await expect(entries.first()).toContainText(/Latest compaction summary|最新压缩摘要/)
  await expect(entries.first()).toHaveAttribute('data-context-kind', 'checkpoint')
  await expectMarkdownContent(entries.first(), summary)
  await expectMarkdownContent(entries.nth(1), retained)
  for (const message of rawInputs) await expect(side.locator('[data-chat-flow-kind="user"]').filter({ hasText: message })).toHaveCount(0)
  await context.locator(':scope > button').click()
  await side.locator('[data-composer-input]').fill('不要调用工具，根据继承上下文回复当前项目核验码和阶段。')
  await side.locator('[data-composer-input]').press('Enter')
  const reply = side.locator('[data-chat-flow-kind="assistant-step"]').last()
  await expect(reply).toBeVisible({ timeout: 60_000 })
  if (real) { await expect(reply).toContainText(marker, { timeout: 60_000 }); await expect(reply).toContainText(/阶段[：:为是\s]*(?:第\s*)?(?:2|二)|第?\s*(?:2|二)\s*阶段/) }
  await expect(side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })).toHaveCount(0)
  expect(userMessagesOf(child).filter(text => text.includes('根据继承上下文回复当前项目核验码和阶段'))).toHaveLength(1)
  if (await mainStop.isVisible()) await mainStop.click()
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(context.locator(':scope > button')).toHaveAttribute('aria-expanded', 'false')
  await expect(reply).toBeVisible()
  await context.locator(':scope > button').click()
  await expect(entries.first()).toHaveAttribute('data-context-kind', 'checkpoint')
  await expectMarkdownContent(entries.first(), summary)
  await expectMarkdownContent(entries.nth(1), retained)
  const name = `${real ? 'official' : 'native'}-compaction-${busy ? 'running' : 'idle'}`
  await page.screenshot({ path: `test-results/${name}.png` })
  writeFileSync(`test-results/${name}.json`, JSON.stringify({ mainId, child, checkpoints: checkpoints.map(event => event.seq), retainedTailSeq: events.filter(event => event.seq < checkpoint.seq && event.type === 'assistant/message').at(-1)!.seq, inheritedLatestCheckpoint: true, restored: true }, null, 2) + '\n')
})
