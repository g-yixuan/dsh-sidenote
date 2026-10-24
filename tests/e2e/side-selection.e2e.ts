import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, sideChatOf, userMessagesOf, selectModel, dragText } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  const name = info.title.startsWith('streaming') ? 'side-streaming' : 'side-selection'
  await page.screenshot({ path: `test-results/${name}.png` })
  if (info.status !== info.expectedStatus) writeFileSync(`test-results/${name}.yml`, await page.locator('body').ariaSnapshot())
})

async function restoreSameSide(page: Page, child: string) {
  await page.reload()
  await prepareSeedPage(page)
  if (await sideChatOf(page).count() === 0) {
    const main = page.locator('[data-composer-seat] [data-composer-input], [data-composer-seat] textarea').first()
    await main.fill('/side')
    await page.getByRole('option', { name: /side/i }).first().click()
    // A restored tab can still be loading when the transcript is ready. The
    // real menu then offers Focus instead of Reopen; both must reach this child.
    const restore = page.getByText(/^(Reopen "|Focus "|重开|聚焦)/)
    await expect(restore).toHaveCount(1)
    await restore.click()
  }
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', child)
}

test('side local selection saves outside, reanchors after reload, and sends full quotes to the same child', async ({ page }) => {
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  const input = side.locator('[data-composer-input]')
  const quoteBody = side.locator('[data-sidenote-quote-body]').filter({ hasText: 'full history snapshot' }).first()
  const overlay = page.locator('[data-dsh-sidenote]')
  const records = () => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), child)
  const parentBefore = userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)
  await input.fill('ordinary body remains clean')

  await dragText(page, quoteBody, 'full history snapshot')
  await expect(overlay.getByText(/^(Ask in side chat|在侧边聊天中提问)$/)).toHaveCount(0)
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await expect(overlay.getByText(/^(Send to:|发送至：)/)).toBeVisible()
  await overlay.locator('input').fill('侧回复的完整注解')
  await input.click()
  await expect(overlay.locator('input')).toHaveCount(0)
  await expect(input).toHaveText('ordinary body remains clean')
  await expect.poll(records).toMatchObject([{ sessionId: child, sourceSessionId: child, sourceSurface: 'side', text: 'full history snapshot', note: '侧回复的完整注解', state: 'active' }])
  await quoteBody.scrollIntoViewIfNeeded()
  const badge = overlay.getByRole('button', { name: /^1 · / })
  await expect(badge).toBeVisible()
  const badgeRect = await badge.boundingBox(), paneRect = await side.boundingBox()
  expect(badgeRect!.x).toBeGreaterThanOrEqual(paneRect!.x)
  expect(badgeRect!.x + badgeRect!.width).toBeLessThanOrEqual(paneRect!.x + paneRect!.width)

  await dragText(page, quoteBody, 'full history snapshot')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('input').press('Enter')
  await expect.poll(records).toHaveLength(2)
  await expect(input).toHaveText('ordinary body remains clean')
  await dragText(page, quoteBody, 'full history snapshot')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('input').fill('discard this new quote')
  await page.keyboard.press('Escape')
  await expect(overlay.locator('input')).toHaveCount(0)
  expect(await records()).toHaveLength(2)
  await input.fill('')

  await restoreSameSide(page, child)
  await expect(side.getByText(/^(2 annotations|2 条注释)$/)).toBeVisible()
  const inherited = side.getByRole('button', { name: /Main conversation context|主线上下文/ })
  if (!await quoteBody.isVisible()) await inherited.click()
  await quoteBody.scrollIntoViewIfNeeded()
  await expect(badge).toBeVisible()
  await inherited.click()
  await expect(badge).toHaveCount(0)
  expect(await records()).toHaveLength(2)
  await inherited.click()
  await quoteBody.scrollIntoViewIfNeeded()
  await expect(badge).toBeVisible()

  await side.getByRole('button', { name: /^(Send|Send message|发送|发送消息|Queue message|加入队列|排队发送)$/ }).click()
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('<note>侧回复的完整注解</note>'))).toHaveLength(1)
  const sent = userMessagesOf(child).find(text => text.includes('<note>侧回复的完整注解</note>'))!
  expect(sent.match(/<quote>full history snapshot<\/quote>/g)).toHaveLength(2)
  await expect.poll(records).toMatchObject([{ state: 'sent' }, { state: 'sent' }])
  await expect(input).toHaveText('')
  await expect(side.getByText(/^(2 annotated|批注 ×2)$/)).toBeVisible()
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)).toEqual(parentBefore)
})

test('streaming side replies and cross-message selections stay ineligible; a stopped complete reply can be quoted', async ({ page }) => {
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const input = side.locator('[data-composer-input]')
  await input.fill('streaming eligibility [e2e:hold]'); await input.press('Enter')
  const reply = side.locator('[data-sidenote-quote-body]').filter({ hasText: 'Controlled E2E reply.' }).last()
  await expect(reply).toHaveAttribute('data-sidenote-streaming', 'true')
  await dragText(page, reply, 'complete assistant response')
  const overlay = page.locator('[data-dsh-sidenote]')
  await expect(overlay.getByRole('toolbar')).toHaveCount(0)
  await side.getByRole('button', { name: /^(Stop generating|停止生成)$/ }).click()
  await expect(reply).toHaveAttribute('data-sidenote-streaming', 'false')

  // Auxiliary Range covers the negative multi-message rule; the positive
  // before/after-streaming flows above and below use real mouse selection.
  await side.evaluate(root => {
    const bodies = root.querySelectorAll('[data-sidenote-quote-body]')
    const range = document.createRange()
    range.setStart(bodies[0]!.firstChild!, 0); range.setEndAfter(bodies[bodies.length - 1]!)
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(overlay.getByRole('toolbar')).toHaveCount(0)
  await input.click()
  await dragText(page, reply, 'complete assistant response')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('input').press('Enter')
  await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('<quote>complete assistant response</quote>'))).toHaveLength(1)
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).some(text => text.includes('<quote>complete assistant response</quote>'))).toBe(false)
})

test('whole side assistant selection keeps paragraphs, lists and code, excluding copy controls', async ({ page }) => {
  await prepareSeedPage(page)
  const parentBefore = userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)
  const child = await openSideChat(page)
  const childBefore = userMessagesOf(child)
  const side = sideChatOf(page)
  const body = side.locator('[data-sidenote-quote-body]').filter({ hasText: 'full history snapshot' }).first()
  await body.scrollIntoViewIfNeeded()
  // Auxiliary full-range coverage complements the local real-mouse cases.
  await body.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el)
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('input').press('Enter')
  const records = () => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), child)
  await expect.poll(records).toHaveLength(1)
  const record = (await records())[0]
  expect(record.text.length).toBeGreaterThan(200)
  expect(record.text).toContain('What works well')
  expect(record.text).toContain('full history snapshot')
  expect(record.text).toContain('const childId = await ctx.sessions.fork({ sessionId: parent.id })')
  expect(record.text).toContain('Overall: solid approach, ship it.')
  expect(record.text).not.toMatch(/Copy|Wrap lines/)
  await side.getByRole('button', { name: /^(Send|Send message|发送|发送消息|Queue message|加入队列|排队发送)$/ }).click()
  await expect.poll(() => userMessagesOf(child).slice(childBefore.length).filter(text => text.includes(record.text))).toHaveLength(1)
  expect(userMessagesOf(child).slice(0, childBefore.length)).toEqual(childBefore)
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!)).toEqual(parentBefore)
})
