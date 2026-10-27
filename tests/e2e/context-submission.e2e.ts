import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dragText, openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
const stopOf = (view: Locator) => view.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
const inputOf = (view: Locator) => view.locator('[data-composer-input]')
const contextLabel = /Side-chat context|含侧边回流上下文/
const noteLabel = /1 annotated|批注 ×1/
const textOf = (data: { content?: { type: string; text?: string }[] }) => (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')

async function addNote(page: Page, main: Locator, note: string) {
  const quote = main.locator('[data-chat-flow-kind="assistant-step"] li').filter({ hasText: 'full history snapshot' }).first()
  await dragText(page, quote, 'full history snapshot')
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('input').fill(note)
  await overlay.locator('input').press('Enter')
  await expect(overlay.locator('input')).toHaveCount(0)
}

async function preview(page: Page, row: Locator, label: RegExp, expected: string) {
  const chip = row.getByRole('button', { name: label })
  await expect(chip).toBeVisible()
  await page.mouse.move(0, 0)
  await chip.hover()
  const panel = page.locator('[data-sidenote-sent-preview]')
  await expect(panel).toContainText(expected)
  await expect(panel).toBeInViewport()
  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
}

async function prepare(page: Page, model: string, marker: string) {
  await prepareSeedPage(page)
  const id = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${id}"]`)
  await selectModel(page, main, model)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, model)
  const question = `不要调用工具，只回复核验码：${marker}`
  const beforeSide = sessionEventsOf(child).at(-1)!.seq
  await inputOf(side).fill(question); await inputOf(side).press('Enter')
  await expect.poll(() => sessionEventsOf(child).some(e => e.seq > beforeSide && e.type === 'turn/end' && e.data.reason?.kind === 'completed'), { timeout: 60000 }).toBe(true)
  await expect(stopOf(side)).toHaveCount(0)
  return { id, main, side, question }
}

for (const mode of ['queue', 'steer'] as const) test(`busy context uses one native ${mode} admission with immediate previews`, async ({ page }) => {
  const { id, main, side, question } = await prepare(page, 'Controlled E2E', 'LOCAL-' + mode)
  const baseline = sessionEventsOf(id).at(-1)!.seq
  const injected: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/sidenote/reflow') injected.push(request.url()) })
  const input = inputOf(main)
  await input.fill('Hold while context is sent [e2e:hold]'); await input.press('Enter')
  await expect(stopOf(main)).toBeVisible()
  // Keep an unrelated item queued: context-only accelerated Enter must send
  // the new context, not steer this already queued item.
  if (mode === 'steer') { await input.fill('Unrelated queued item'); await input.press('Enter'); await expect(main.locator('[data-queue-dock]')).toContainText('Unrelated queued item') }
  await addNote(page, main, 'NOTE-' + mode)
  await side.getByRole('button', { name: /^(Bring back to main conversation|带回主对话)$/ }).last().click()
  if (mode === 'queue') {
    await main.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
    await input.fill('Queued body and image with context')
    await expect(main.getByRole('button', { name: /^(Queue message|加入队列|排队发送)$/ })).toBeEnabled()
  }
  await input.press(mode === 'queue' ? 'Enter' : 'ControlOrMeta+Enter')
  const row = mode === 'queue' ? main.locator('[data-queue-dock]') : main.locator('[data-pending-steering]')
  await preview(page, row, contextLabel, question)
  await preview(page, row, noteLabel, 'NOTE-' + mode)
  expect(userMessagesOf(id).some(text => text.includes('<note>NOTE-' + mode + '</note>'))).toBe(false)
  expect(injected).toEqual([])
  if (mode === 'steer') await expect(main.locator('[data-queue-dock]')).toContainText('Unrelated queued item')
  await page.screenshot({ path: `test-results/context-${mode}-pending.png` })
  if (mode === 'queue') {
    await stopOf(main).click(); await expect(stopOf(main)).toHaveCount(0)
    await page.reload()
    await preview(page, row, contextLabel, question)
    expect(userMessagesOf(id).some(text => text.includes('<note>NOTE-queue</note>'))).toBe(false)
    await input.fill('Resume the preserved queue'); await input.press('Enter')
  }
  await expect.poll(() => userMessagesOf(id).filter(text => text.includes('<note>NOTE-' + mode + '</note>')), { timeout: 55000 }).toHaveLength(1)
  await expect(stopOf(main)).toHaveCount(0, { timeout: 55000 })
  const events = sessionEventsOf(id).filter(e => e.seq > baseline)
  const sent = events.filter(e => e.type === 'user/message' && textOf(e.data).includes('<note>NOTE-' + mode + '</note>'))
  expect(sent).toHaveLength(1)
  expect(textOf(sent[0]!.data)).toContain(`<问>${question}</问>`)
  if (mode === 'queue') expect(sent[0]!.data.content.some((b: { type: string }) => b.type === 'image')).toBe(true)
  expect(events.some(e => e.type === 'user/message' && e.data.source?.kind === 'dsh-sidenote')).toBe(false)
  const bubble = main.locator('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]').filter({ has: page.getByRole('button', { name: noteLabel }) }).last()
  await preview(page, bubble, contextLabel, question)
  await page.reload()
  await preview(page, bubble, contextLabel, question)
})

for (const mode of ['queue', 'steer'] as const) test(`official Flash receives busy ${mode} reflow and annotation together exactly once`, async ({ page }) => {
  test.skip(!process.env.DSH_E2E_REAL_MODEL, 'Set DSH_E2E_REAL_KEY_FILE for the official DeepSeek lane')
  test.setTimeout(180000)
  const sideMarker = 'SIDE-' + randomUUID(), noteMarker = 'NOTE-' + randomUUID()
  const { id, main, side, question } = await prepare(page, 'DeepSeek Flash (official E2E)', sideMarker)
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: sideMarker }).last()).toBeVisible()
  const baseline = sessionEventsOf(id).at(-1)!.seq
  const input = inputOf(main)
  await input.fill('调用 bash 工具执行 sleep 35，等待命令结束后只回复准备完成。不要读取文件，不要调用其他工具。')
  await input.press('Enter')
  await expect.poll(() => sessionEventsOf(id).some(e => e.seq > baseline && e.type === 'tool/call' && JSON.stringify(e.data).includes('sleep 35')), { timeout: 60000 }).toBe(true)
  await expect(stopOf(main)).toBeVisible()
  await addNote(page, main, noteMarker)
  await side.getByRole('button', { name: /^(Bring back to main conversation|带回主对话)$/ }).last().click()
  const prompt = '根据这条消息携带的侧聊回流与批注，逐字抄出 SIDE- 开头和 NOTE- 开头的两个核验码。不要调用工具，不要猜测。'
  await input.fill(prompt); await input.press(mode === 'queue' ? 'Enter' : 'ControlOrMeta+Enter')
  const row = mode === 'queue' ? main.locator('[data-queue-dock]') : main.locator('[data-pending-steering]')
  await preview(page, row, contextLabel, sideMarker)
  await preview(page, row, noteLabel, noteMarker)
  expect(userMessagesOf(id).some(text => text.includes(noteMarker))).toBe(false)
  await page.screenshot({ path: `test-results/official-context-${mode}-pending.png` })
  await expect.poll(() => sessionEventsOf(id).some(e => e.seq > baseline && e.type === 'assistant/message' && JSON.stringify(e.data).includes(sideMarker) && JSON.stringify(e.data).includes(noteMarker)), { timeout: 90000 }).toBe(true)
  await expect(stopOf(main)).toHaveCount(0, { timeout: 45000 })
  const events = sessionEventsOf(id).filter(e => e.seq > baseline)
  const admitted = events.filter(e => e.type === 'user/message' && textOf(e.data).includes(noteMarker))
  expect(admitted).toHaveLength(1)
  const text = textOf(admitted[0]!.data)
  expect(text.match(/<reflow source=/g)).toHaveLength(1)
  expect(text).toContain(`<问>${question}</问>`)
  expect(text).toContain(sideMarker)
  expect(text).toContain(`<note>${noteMarker}</note>`)
  expect(text.endsWith(prompt)).toBe(true)
  expect(events.some(e => e.type === 'user/message' && e.data.source?.kind === 'dsh-sidenote')).toBe(false)
  const turnOf = (seq: number) => events.filter(e => e.seq < seq && e.type === 'turn/start').at(-1)?.data.turn
  const firstUser = events.find(e => e.type === 'user/message' && e.data.source?.kind === 'user')!
  if (mode === 'queue') expect(turnOf(admitted[0]!.seq)).toBeGreaterThan(turnOf(firstUser.seq))
  else expect(turnOf(admitted[0]!.seq)).toBe(turnOf(firstUser.seq))
  const bubble = main.locator('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]').filter({ hasText: prompt }).last()
  await preview(page, bubble, contextLabel, sideMarker)
  await page.reload(); await preview(page, bubble, noteLabel, noteMarker)
  writeFileSync(`test-results/official-context-${mode}.json`, JSON.stringify({ model: 'deepseek-flash', mode, sideMarker, noteMarker, immediatePreview: true, receivedTogether: true, admissionCount: admitted.length, correctTurn: true, reloadPreview: true }, null, 2) + '\n')
  await page.screenshot({ path: `test-results/official-context-${mode}-final.png` })
})
