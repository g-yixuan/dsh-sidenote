import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, sideChatOf, userMessagesOf, userMessageContentsOf, selectModel } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  const dir = process.env.DSH_E2E_EVIDENCE_DIR ?? 'test-results'
  mkdirSync(dir, { recursive: true })
  const name = info.title.startsWith('busy fork') ? `busy-fork-${info.title.includes('image') ? 'image' : 'text'}` : 'native-queue-steer'
  if (info.title.startsWith('busy fork')) await sideChatOf(page).locator('[data-sidenote-main-context] button').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(dir, name + '.png') })
  if (info.status !== info.expectedStatus) writeFileSync(join(dir, name + '.yml'), await page.locator('body').ariaSnapshot())
})

async function addSideQuote(page: Page, note: string): Promise<void> {
  const quote = page.locator('[data-chat-flow-kind="assistant-step"] li').filter({ hasText: 'full history snapshot' }).first()
  await quote.scrollIntoViewIfNeeded()
  const points = await quote.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const needle = 'full history snapshot'
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(needle)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at); range.setEnd(node, at + needle.length)
      const rect = range.getBoundingClientRect()
      return { x1: rect.left + 0.1, x2: rect.right - 0.1, y: rect.top + rect.height / 2 }
    }
    return null
  })
  expect(points).not.toBeNull()
  await page.mouse.move(points!.x1, points!.y)
  await page.mouse.down(); await page.mouse.move(points!.x2, points!.y, { steps: 10 }); await page.mouse.up()
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText(/^(Ask in side chat|在侧边聊天中提问)$/).click()
  await overlay.locator('input').fill(note)
  await overlay.locator('input').press('Enter')
  await expect(overlay.locator('input')).toHaveCount(0)
}

test('native Queue acceptance, Stop preserving queued quotes, and explicit Steer', async ({ page }) => {
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  await expect(side.getByRole('button', { name: /^(Select model|选择模型).*Controlled E2E/ })).toBeVisible()
  const input = side.locator('[data-composer-input]')
  const stop = side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  const records = () => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), child)
  const parentBefore = userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)

  await input.fill('holding for native queue [e2e:hold]'); await input.press('Enter')
  await expect(side.getByText('Controlled E2E reply. This complete assistant response supports quote selection.', { exact: true }).last()).toBeVisible()
  await expect(stop).toBeVisible()
  await addSideQuote(page, 'native queue quote')
  await input.fill('queued annotation body'); await input.press('Enter')
  // The provider is still blocked: no durable transcript echo can acknowledge
  // this quote yet. Only the actual host Inbox/Queue occurrence can do so.
  await expect.poll(records).toMatchObject([{ state: 'sent' }])
  expect(userMessagesOf(child).filter(text => text.includes('queued annotation body'))).toHaveLength(0)
  await stop.click()
  await expect(stop).toHaveCount(0)
  await expect(input).toHaveText('')
  // Stop aborts the current turn and keeps the native Inbox. The actual loop
  // remains idle until another send wakes it; do not mistake idle for a loss.
  expect(userMessagesOf(child).filter(text => text.includes('queued annotation body'))).toHaveLength(0)
  await input.fill('resume preserved native queue'); await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('queued annotation body'))).toHaveLength(1)
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('resume preserved native queue'))).toHaveLength(1)
  await expect(stop).toHaveCount(0)

  await input.fill('holding for native steer [e2e:hold]'); await input.press('Enter')
  await expect(stop).toBeVisible()
  await addSideQuote(page, 'native steer quote')
  await input.fill('steered annotation body'); await input.press('ControlOrMeta+Enter')
  await expect.poll(records).toMatchObject([{ state: 'sent' }, { state: 'sent' }])
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('steered annotation body')), { timeout: 45_000 }).toHaveLength(1)
  expect(userMessagesOf(child).find(text => text.includes('steered annotation body'))).toContain('<note>native steer quote</note>')
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)).toEqual(parentBefore)
  if (await stop.isVisible()) await stop.click()
})

for (const withImage of [false, true]) test(`busy fork keeps the parent running and consumes its progress snapshot once after acceptance (${withImage ? 'image + text' : 'text'})`, async ({ page }) => {
  await prepareSeedPage(page)
  const mainSeat = page.locator('[data-composer-seat]').first()
  await mainSeat.getByRole('button', { name: /^(Select model|请选择模型|选择模型)/ }).click()
  const modelGroup = page.getByRole('menuitem', { name: /^(Model|模型) / })
  const model = page.getByRole('menuitemradio', { name: 'Controlled E2E', exact: true })
  await expect(modelGroup.or(model).first()).toBeVisible()
  if (await modelGroup.isVisible()) await modelGroup.click()
  await model.click()
  await expect(mainSeat.getByRole('button', { name: /^(Select model|选择模型).*Controlled E2E/ })).toBeVisible()
  const mainInput = mainSeat.locator('[data-composer-input], textarea').first()
  await mainInput.fill('main is still executing the busy fork request [e2e:hold]')
  await mainInput.press('Enter')
  const mainStop = mainSeat.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  await expect(mainStop).toBeVisible()

  const child = await openSideChat(page)
  await expect(mainStop).toBeVisible()
  const side = sideChatOf(page)
  const input = side.locator('[data-composer-input]')
  await expect(input).toHaveText('')
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/Updates on first send|发送时更新/)
  const panelBox = (await side.boundingBox())!
  const inputBox = (await input.boundingBox())!
  expect(inputBox.y).toBeGreaterThan(panelBox.y + panelBox.height * 0.65)
  await addSideQuote(page, 'busy fork annotation')
  if (withImage) await side.locator('input[type=file]').setInputFiles('tests/fixtures/quote-test.png')
  await input.fill('first accepted busy fork question'); await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('first accepted busy fork question'))).toHaveLength(1)
  const first = userMessagesOf(child).find(text => text.includes('first accepted busy fork question'))!
  expect(first.match(/<mainline-progress-snapshot /g)).toHaveLength(1)
  expect(first).toContain('main is still executing the busy fork request [e2e:hold]')
  expect(first).toContain('<note>busy fork annotation</note>')
  if (withImage) {
    expect(userMessageContentsOf(child).find(content => content.some(block => block.text?.includes('first accepted busy fork question')))?.some(block => block.type === 'image')).toBe(true)
    await expect(side.locator('[data-chat-flow-kind="user"] img').last()).toBeVisible()
  }
  await expect(input).toHaveText('')
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
  await expect(side.locator('[data-sidenote-main-context]')).toContainText('main is still executing the busy fork request [e2e:hold]')
  await expect(side.locator('[data-sidenote-progress-snapshot]')).not.toBeVisible()

  const sideStop = side.getByRole('button', { name: /^(Stop generating|停止生成)$/ })
  await expect(sideStop).toHaveCount(0)
  await input.fill('second busy fork question'); await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('second busy fork question'))).toHaveLength(1)
  expect(userMessagesOf(child).find(text => text.includes('second busy fork question'))).not.toContain('<mainline-progress-snapshot')
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).some(text => text.includes('accepted busy fork question') || text.includes('second busy fork question'))).toBe(false)
  if (await mainStop.isVisible()) await mainStop.click()
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(side.locator('[data-sidenote-main-context]')).toContainText(/As of|截至/)
  await expect(side.locator('[data-sidenote-main-context]')).toContainText('main is still executing the busy fork request [e2e:hold]')
})
