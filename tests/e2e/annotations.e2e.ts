import { test, expect, type Page } from '@playwright/test'
import { prepareSeedPage, registerSeedWorkspace, sideChatOf, userMessagesOf, userMessageContentsOf, openSideChat } from './journey'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

test.beforeAll(registerSeedWorkspace)

const OVERLAY = '[data-dsh-sidenote]'
const STORAGE_KEY = `dsh-sidenote:annotations:v1:${process.env.DSH_E2E_SEED_SESSION}`
const composerOf = (page: Page) => page.locator('[data-composer-seat] [data-composer-input], [data-composer-seat] textarea').first()
const chipOf = (page: Page) => page.getByText(/^(\d+ annotations?|\d+ 条注释)$/).first()

async function selectControlledModel(page: Page): Promise<void> {
  const side = sideChatOf(page)
  await side.getByRole('button', { name: /^(Model:|模型：)/ }).click()
  await page.getByRole('menuitem', { name: 'Controlled E2E', exact: true }).click()
  await expect(side.getByRole('button', { name: /^(Model:|模型：) controlled$/ })).toBeVisible()
}

async function items(page: Page): Promise<Array<{ id: number; number: number; note: string; state: string }>> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), STORAGE_KEY)
}

async function selectQuote(page: Page): Promise<void> {
  const quote = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()
  await quote.scrollIntoViewIfNeeded()
  const points = await quote.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const needle = 'full history snapshot'
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(needle)
      if (at < 0) continue
      const start = document.createRange()
      start.setStart(node, at); start.setEnd(node, at + 1)
      const end = document.createRange()
      end.setStart(node, at + needle.length - 1); end.setEnd(node, at + needle.length)
      const a = start.getBoundingClientRect(), b = end.getBoundingClientRect()
      return { x1: a.left + 0.1, y1: a.top + a.height / 2, x2: b.right - 0.1, y2: b.top + b.height / 2 }
    }
    return null
  })
  expect(points).not.toBeNull()
  await page.mouse.move(points!.x1, points!.y1)
  await page.mouse.down()
  await page.mouse.move(points!.x2, points!.y2, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain('full history snapshot')
}

async function addQuote(page: Page): Promise<void> {
  await selectQuote(page)
  await page.locator(OVERLAY).getByText(/^(Add to conversation|添加到对话)$/).click()
  await expect(page.locator(`${OVERLAY} input`)).toBeVisible()
}

test.describe('annotation editor lifecycle', () => {
  test.beforeEach(async ({ page }) => { await prepareSeedPage(page) })

  test('side-chat note survives outside click; empty note saves and Escape discards', async ({ page }) => {
    const overlay = page.locator(OVERLAY)
    const ask = async () => {
      await selectQuote(page)
      await overlay.getByText(/^(Ask in side chat|在侧边聊天中提问)$/).click()
      await expect(overlay.locator('input')).toBeVisible()
    }
    await ask()
    await overlay.locator('input').fill('侧边外点保存的完整注解')
    await composerOf(page).click()
    await expect(overlay.locator('input')).toHaveCount(0)
    const side = sideChatOf(page)
    await expect(side).toHaveCount(1, { timeout: 30_000 })
    const childId = await side.getAttribute('data-sidenote-chat-session')
    expect(childId).toBeTruthy()
    const sideInput = side.getByPlaceholder(/^(Message…|输入消息)/)
    const childItems = async () => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), childId!)
    await expect(sideInput).toHaveValue('')
    await expect.poll(childItems).toMatchObject([{ text: 'full history snapshot', note: '侧边外点保存的完整注解', state: 'active', sessionId: childId, sourceSessionId: process.env.DSH_E2E_SEED_SESSION, sourceSurface: 'main' }])
    expect(await items(page)).toEqual([])

    await ask()
    await composerOf(page).click()
    await expect(overlay.locator('input')).toHaveCount(0)
    await expect.poll(childItems).toHaveLength(2)
    expect((await childItems())[1]).toMatchObject({ text: 'full history snapshot', note: '', state: 'active' })
    await expect(sideInput).toHaveValue('')
    const beforeCancel = await childItems()
    await ask()
    await overlay.locator('input').fill('Escape 要放弃的注解')
    await page.keyboard.press('Escape')
    await expect(overlay.locator('input')).toHaveCount(0)
    expect(await childItems()).toEqual(beforeCancel)
    await expect(sideInput).toHaveValue('')

    const parentBefore = userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)
    await side.getByRole('button', { name: /^(Send|发送)$/ }).click()
    await expect.poll(() => userMessagesOf(childId!).filter(text => text.includes('<note>侧边外点保存的完整注解</note>'))).toHaveLength(1)
    const sent = userMessagesOf(childId!).find(text => text.includes('<note>侧边外点保存的完整注解</note>'))!
    expect(sent.match(/<quote>full history snapshot<\/quote>/g)).toHaveLength(2)
    await expect.poll(childItems).toMatchObject([{ state: 'sent' }, { state: 'sent' }])
    expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)).toEqual(parentBefore)
    await expect(sideInput).toHaveValue('')
    await expect(side.getByText(/^(2 annotated|批注 ×2)$/)).toBeVisible()
    const evidence = process.env.DSH_E2E_EVIDENCE_DIR ?? 'test-results'
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'side-note-outside-saved.png') })
  })

  test('empty note survives composer click and reload', async ({ page }) => {
    await addQuote(page)
    await composerOf(page).click()
    await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
    await expect(chipOf(page)).toBeVisible()
    expect(await items(page)).toMatchObject([{ note: '', state: 'active' }])
    await page.reload()
    await expect(chipOf(page)).toBeVisible()
    expect(await items(page)).toMatchObject([{ note: '', state: 'active' }])
    await page.screenshot({ path: 'test-results/annotation-empty-saved.png' })
  })

  test('typed note survives composer click, reload and Enter submission', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('刚输入的中文注解')
    const composer = composerOf(page)
    await composer.click()
    await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
    expect(await items(page)).toMatchObject([{ note: '刚输入的中文注解', state: 'active' }])
    await expect(chipOf(page)).toBeVisible()
    await expect(composer).not.toContainText('刚输入的中文注解')
    await page.reload()
    await expect(chipOf(page)).toBeVisible()
    expect(await items(page)).toMatchObject([{ note: '刚输入的中文注解' }])
    await composer.click()
    await composer.pressSequentially('review annotation note')
    await composer.press('Enter')
    const bubble = page.locator('[data-chat-flow-kind="user"]').filter({ hasText: 'review annotation note' }).last()
    await expect(bubble).toContainText('<note>刚输入的中文注解</note>', { timeout: 10_000 })
    await expect.poll(() => items(page)).toMatchObject([{ note: '刚输入的中文注解', state: 'sent' }])
    await expect(chipOf(page)).toHaveCount(0)
    await page.screenshot({ path: 'test-results/annotation-sent.png' })
  })

  test('Escape explicitly discards a new annotation', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('要放弃的注解')
    await page.keyboard.press('Escape')
    await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
    await expect(chipOf(page)).toHaveCount(0)
    expect(await items(page)).toEqual([])
  })

  test('clicking inside keeps editor open; outside edit preserves saved note', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).click()
    await expect(page.locator(`${OVERLAY} input`)).toBeVisible()
    await page.locator(`${OVERLAY} input`).fill('已保存注解')
    await page.locator(OVERLAY).getByRole('button', { name: /^(Save note|确认注解)$/ }).click()
    await page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first().scrollIntoViewIfNeeded()
    await page.locator(OVERLAY).getByRole('button', { name: '1', exact: true }).click()
    const editor = page.locator(`${OVERLAY} textarea`)
    await expect(editor).toHaveValue('已保存注解')
    await editor.fill('不应保存的修改')
    await composerOf(page).click()
    await expect(editor).toHaveCount(0)
    expect(await items(page)).toMatchObject([{ note: '已保存注解' }])
  })

  test('switching from new annotation to an existing badge must not save into the previous annotation', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('第一条原始注解')
    await page.locator(OVERLAY).getByRole('button', { name: /^(Save note|确认注解)$/ }).click()
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('第二条新建草稿')
    await page.locator(OVERLAY).getByRole('button', { name: '1', exact: true }).click()
    const editor = page.locator(`${OVERLAY} textarea`)
    await expect(editor).toHaveValue('第一条原始注解')
    await editor.fill('当前编辑第一条，应被取消')
    await page.screenshot({ path: 'test-results/annotation-switched-editor.png' })
    await composerOf(page).click()
    await expect(editor).toHaveCount(0)
    const saved = await items(page)
    await page.screenshot({ path: 'test-results/annotation-switch-after-outside.png' })
    expect(saved.find(item => item.number === 1)?.note).toBe('第一条原始注解')
    expect(saved.find(item => item.number === 2)?.note).toBe('')
  })

  test('main annotation keeps a native side-chat reference through serialization', async ({ page }) => {
    await openSideChat(page)
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('原生引用应完整保留')
    const composer = composerOf(page)
    await composer.click()
    await composer.pressSequentially('@')
    const option = page.getByRole('option').filter({ hasText: '侧边聊天' })
    await expect(option).toHaveCount(1)
    await expect(option).toBeVisible()
    await option.click()
    await composer.pressSequentially(' native reference admission')
    await composer.press('Enter')
    await expect.poll(() => userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).filter(text => text.includes('native reference admission'))).toHaveLength(1)
    const wire = userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).find(text => text.includes('native reference admission'))!
    expect(wire).toContain('<note>原生引用应完整保留</note>')
    expect(wire).toContain('<side-chat-reference source=')
    expect(wire).toContain('full history snapshot')
    expect(wire).toContain('</side-chat-reference>')
    await expect.poll(() => items(page)).toMatchObject([{ state: 'sent' }])
  })

  test('side annotation and image use one native admission and leave the parent untouched', async ({ page }) => {
    const child = await openSideChat(page)
    const side = sideChatOf(page)
    await selectControlledModel(page)
    const input = side.getByPlaceholder(/^(Message…|输入消息)/)
    await input.fill('attachment quote admission')
    await selectQuote(page)
    await page.locator(OVERLAY).getByText(/^(Ask in side chat|在侧边聊天中提问)$/).click()
    await page.locator(`${OVERLAY} input`).fill('图片与引用一起发送')
    await page.locator(`${OVERLAY} input`).press('Enter')
    await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
    await expect(input).toHaveValue('attachment quote admission')
    // Browser File intake → native draft registry → native serializer → host log.
    await side.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
    await expect(side.locator('img[src^="blob:"]')).toHaveCount(1)
    const parentBefore = userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)
    await side.getByRole('button', { name: /^(Send|发送)$/ }).click()
    await expect.poll(() => userMessagesOf(child).filter(text => text.includes('attachment quote admission'))).toHaveLength(1)
    const content = userMessageContentsOf(child).find(blocks => blocks.some(block => block.text?.includes('attachment quote admission')))!
    expect(content.some(block => block.type === 'image')).toBe(true)
    expect(content.filter(block => block.type === 'text').map(block => block.text).join('\n')).toContain('<note>图片与引用一起发送</note>')
    await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), child)).toMatchObject([{ state: 'sent' }])
    await expect(input).toHaveValue('')
    await expect(side.locator('img[src^="blob:"]')).toHaveCount(0)
    await expect(side.getByText('Controlled E2E reply. This complete assistant response supports quote selection.', { exact: true }).last()).toBeVisible()
    expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)).toEqual(parentBefore)
  })
})

test('real malformed-image rejection keeps quote and clean body, then retries once', async ({ page }) => {
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectControlledModel(page)
  await selectQuote(page)
  await page.locator(OVERLAY).getByText(/^(Ask in side chat|在侧边聊天中提问)$/).click()
  await page.locator(`${OVERLAY} input`).fill('失败后需要保留的注解')
  await page.locator(`${OVERLAY} input`).press('Enter')
  await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
  const input = side.getByPlaceholder(/^(Message…|输入消息)/)
  const body = 'retry after actual host rejection'
  await input.fill(body)
  await side.locator('input[type=file]').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not a valid PNG image') })
  await side.getByRole('button', { name: /^(Send|发送)$/ }).click()
  await expect(side.getByRole('alert')).toBeVisible()
  await expect(input).toHaveValue(body)
  expect(userMessagesOf(child).filter(text => text.includes(body))).toHaveLength(0)
  const childItems = () => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), child)
  expect(await childItems()).toMatchObject([{ state: 'active', note: '失败后需要保留的注解' }])
  await side.getByRole('button', { name: /^(Remove|移除)$/ }).click()
  await side.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
  await side.getByRole('button', { name: /^(Send|发送)$/ }).click()
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes(body))).toHaveLength(1)
  expect(userMessagesOf(child).find(text => text.includes(body))!.match(/<annotation id=/g)).toHaveLength(1)
  await expect.poll(childItems).toMatchObject([{ state: 'sent' }])
  await expect(input).toHaveValue('')
})
