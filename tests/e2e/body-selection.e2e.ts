import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Annotation } from '../../src/client/annotations/model.ts'
import { restartHost } from './host'
import { dragBetween, dragText, openGeneralSettings, openSideChat, prepareSeedPage, registerSeedWorkspace, revealForReading, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.use({ viewport: { width: 1280, height: 1000 } })
test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await page.screenshot({ path: info.outputPath('body-selection-failure.png') })
    writeFileSync(info.outputPath('body-selection-failure.yml'), await page.locator('body').ariaSnapshot())
  }
})

const toolbarOf = (page: Page) => page.locator('[data-dsh-sidenote] [role="toolbar"]')
const records = (page: Page, id: string) => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]') as Annotation[], id)
const replyOf = (view: Locator, text: string) => view.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])').filter({ hasText: text }).last()
const badgeOf = (page: Page, note: string) => page.locator('[data-dsh-sidenote]').getByTitle(new RegExp(note))

async function setReplies(page: Page, choice: 'all' | 'final') {
  await openGeneralSettings(page)
  await page.getByRole('button', { name: /^(All replies|Final answer only|全部回复|仅最终回答)$/ }).click()
  await page.getByRole('menuitem', { name: choice === 'all' ? /^(All replies|全部回复)$/ : /^(Final answer only|仅最终回答)$/ }).click()
  await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
}

async function processOpen(page: Page, view: Locator, turn: number, open: boolean) {
  const toggle = view.locator(`button[data-turn-process="${turn}"]`)
  await revealForReading(page, toggle)
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', String(open))
}

async function addQuote(page: Page, note: string) {
  await toolbarOf(page).getByRole('button', { name: /^(Add to conversation|添加到对话)$/ }).click()
  const editor = page.locator('[data-dsh-sidenote] input')
  await editor.fill(note); await editor.press('Enter')
}

async function send(view: Locator, id: string, text: string) {
  const before = sessionEventsOf(id).at(-1)!.seq
  await view.locator('[data-composer-input]').fill(text)
  await view.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => sessionEventsOf(id).some(event => event.seq > before && event.type === 'turn/end' && event.data.reason.kind === 'completed'), { timeout: 90_000 }).toBe(true)
  return sessionEventsOf(id).filter(event => event.seq > before)
}

test('body-only selection survives display changes and rejects visible process controls', async ({ page }) => {
  await prepareSeedPage(page)
  await setReplies(page, 'all')
  const id = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator('[data-conversation-session]').first()
  const beforeText = 'Reading the README and listing the workspace files in parallel.'
  const afterText = 'The README describes this side-chat plugin, and the workspace holds README.md plus package.json. Nothing else to flag.'
  const first = replyOf(main, beforeText), last = replyOf(main, afterText)
  await processOpen(page, main, 3, false)
  await dragText(page, first, beforeText)
  await expect(toolbarOf(page)).toBeVisible()
  await dragBetween(page, first, beforeText, last, afterText)
  await expect(toolbarOf(page)).toBeVisible()
  await page.screenshot({ path: 'test-results/body-selection-main.png' })
  const note = 'BODY-' + randomUUID()
  await addQuote(page, note)
  const saved = (await records(page, id)).find(annotation => annotation.note === note)!
  expect(saved.anchors).toHaveLength(2)
  expect(saved.text).toContain(beforeText); expect(saved.text).toContain(afterText)

  await setReplies(page, 'final')
  await expect(first).toBeHidden()
  expect((await records(page, id)).find(annotation => annotation.note === note)?.text).toBe(saved.text)
  await expect(badgeOf(page, note)).toHaveCount(0)
  await page.reload(); await prepareSeedPage(page)
  await setReplies(page, 'all')
  await revealForReading(page, first)
  await expect(badgeOf(page, note)).toBeVisible()
  await processOpen(page, main, 3, true)
  await dragBetween(page, first, beforeText, last, afterText)
  await expect(toolbarOf(page)).toHaveCount(0)
  await main.locator('[data-composer-input]').click()
  await badgeOf(page, note).hover()
  const highlights = page.locator('[data-dsh-sidenote] [class$="_highlight"]')
  await expect(highlights).not.toHaveCount(0)
  const processBox = await main.locator('[data-step-process]').first().boundingBox()
  expect(processBox).not.toBeNull()
  expect(await highlights.evaluateAll((elements, area) => elements.some(element => {
    const rect = element.getBoundingClientRect()
    return rect.left < area.x + area.width && rect.right > area.x && rect.top < area.y + area.height && rect.bottom > area.y
  }), processBox!)).toBe(false)
  await page.screenshot({ path: 'test-results/body-selection-expanded.png' })

  await processOpen(page, main, 4, true)
  const reasoningRow = main.locator('[data-chat-group-part="reasoning"][data-chat-turn="4"]')
  if (!await reasoningRow.isVisible()) await reasoningRow.locator('xpath=ancestor::*[@data-step-process][1]').getByRole('button').first().click()
  const thinking = reasoningRow.locator('[data-variant="think"]')
  await thinking.getByRole('button').first().click()
  await dragText(page, thinking, 'Ship the todo card first')
  await expect(toolbarOf(page)).toHaveCount(0)
  await processOpen(page, main, 3, false)
  await selectModel(page, main, 'Controlled E2E')
  const prompt = 'Finish the body-selection check ' + randomUUID()
  await send(main, id, prompt)
  expect(userMessagesOf(id).findLast(text => text.includes(prompt))).toContain(`<quote>${saved.text}</quote>`)
  await setReplies(page, 'final')
})

for (const real of [false, true]) test(`${real ? 'official Flash main' : 'native side'} body-only tool progress quotes persist and reach the intended conversation`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Requires the isolated official Flash lane')
  test.setTimeout(240_000)
  const wireFile = join(process.env.DSH_E2E_HOME!, '..', 'official-wire.json')
  const wireStart: number = real && existsSync(wireFile) ? JSON.parse(readFileSync(wireFile, 'utf8')).length : 0
  await prepareSeedPage(page)
  await setReplies(page, 'all')
  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const id = real ? mainId : await openSideChat(page)
  const view = real ? page.locator('[data-conversation-session]').first() : sideChatOf(page)
  const parentBefore = userMessagesOf(mainId)
  const pre = real ? 'PRE-' + randomUUID() : 'PRE-CONTROLLED'
  const post = real ? 'POST-' + randomUUID() : 'POST-CONTROLLED'
  writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, 'body-selection.txt'), post + '\n')
  await selectModel(page, view, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  const events = await send(view, id, real
    ? `先单独输出 ${pre}，然后调用 read 工具读取 body-selection.txt。最终回答只回复文件中的完整标记，不调用其他工具。`
    : '[e2e:body-selection] Read body-selection.txt and return the final marker.')
  const turn = events.find(event => event.type === 'turn/end')!.data.turn as number
  expect(events.some(event => event.type === 'tool/result' && JSON.stringify(event.data).includes(post))).toBe(true)
  const first = replyOf(view, pre), last = replyOf(view, post)
  await processOpen(page, view, turn, false)
  await dragBetween(page, first, pre, last, post)
  await expect(toolbarOf(page)).toBeVisible()
  await page.screenshot({ path: `test-results/body-selection-${real ? 'flash' : 'side'}.png` })
  const note = 'GENERATED-' + randomUUID()
  await addQuote(page, note)
  const annotation = (await records(page, id)).find(item => item.note === note)!
  expect(annotation.anchors).toHaveLength(2)
  expect(annotation.text).toContain(pre); expect(annotation.text).toContain(post)
  await restartHost(page); await prepareSeedPage(page)
  await revealForReading(page, first)
  await expect(badgeOf(page, note)).toBeVisible()
  const followup = '不要调用工具，只回复“引用核验通过”。' + randomUUID()
  await send(view, id, followup)
  expect(userMessagesOf(id).findLast(text => text.includes(followup))).toContain(`<quote>${annotation.text}</quote>`)
  if (!real) expect(userMessagesOf(mainId)).toEqual(parentBefore)

  if (real) {
    await dragBetween(page, first, pre, last, post)
    await toolbarOf(page).getByRole('button', { name: /^(Ask in side chat|在侧边聊天中提问)$/ }).click()
    const sideNote = 'SIDE-' + randomUUID()
    const editor = page.locator('[data-dsh-sidenote] input')
    await editor.fill(sideNote); await editor.press('Enter')
    const side = sideChatOf(page)
    await expect(side.locator('[data-composer-input]')).toBeVisible()
    const child = (await side.getAttribute('data-sidenote-chat-session'))!
    await selectModel(page, side, 'DeepSeek Flash (official E2E)')
    const beforeSide = userMessagesOf(mainId)
    const question = '不要调用工具，逐字列出刚才引用中的 PRE 和 POST 两个完整标记。' + randomUUID()
    await send(side, child, question)
    expect(userMessagesOf(child).findLast(text => text.includes(question))).toContain(`<quote>${annotation.text}</quote>`)
    const answer = side.locator('[data-chat-flow-kind="assistant-step"]').last()
    await expect(answer).toContainText(pre); await expect(answer).toContainText(post)
    expect(userMessagesOf(mainId)).toEqual(beforeSide)
    const wire = (JSON.parse(readFileSync(wireFile, 'utf8')) as { model: string; status: number; finished?: boolean }[]).slice(wireStart)
    expect(wire.length).toBeGreaterThanOrEqual(4)
    expect(wire.every(request => request.model === 'deepseek-flash' && request.status === 200 && request.finished)).toBe(true)
    writeFileSync('test-results/body-selection-flash-wire.json', JSON.stringify(wire, null, 2) + '\n')
  }
  writeFileSync(`test-results/body-selection-${real ? 'flash' : 'side'}.json`, JSON.stringify({ model: real ? 'deepseek-flash' : 'controlled', progressSelected: true, multipleAnchors: true, restoredAfterRestart: true, quoteSent: true, ...(real ? { sideReceivedBothMarkers: true } : { parentUnchanged: true }) }, null, 2) + '\n')
  await setReplies(page, 'final')
})
