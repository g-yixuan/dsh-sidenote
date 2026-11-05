import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { restartHost } from './host'
import { openGeneralSettings, dragText, loadEarlierUntil, openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('native-quote-failure.png') })
})
const quoteAction = /^(Quote|引用)$/
const addAction = /^(Add to conversation|添加到对话)$/
const inputOf = (view: Locator) => view.locator('[data-composer-input]')
const toolbarOf = (page: Page) => page.locator('[data-dsh-sidenote] [role="toolbar"]')

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await openGeneralSettings(page)
  const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
  await dialog.getByRole('button', { name: 'Sidenote', exact: true }).click()
  const toggle = dialog.getByRole('switch', { name: /^(Hide native quote|隐藏原生引用)$/ })
  await expect(toggle).toBeEnabled()
  if (await toggle.getAttribute('aria-checked') !== String(hidden)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(hidden))
  await expect(toggle).toBeEnabled()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText(/(?:finished replying|回复完成)$/)).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: `test-results/sidenote-settings-${hidden ? 'hidden' : 'shown'}.png` })
  await dialog.getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
}

async function submit(view: Locator, id: string, text: string, append = false): Promise<void> {
  const before = sessionEventsOf(id).filter(event => event.type === 'turn/end').length
  const input = inputOf(view)
  if (append) {
    await input.press('ControlOrMeta+End')
    await input.pressSequentially(text)
  } else await input.fill(text)
  await input.press('Enter')
  await expect.poll(() => userMessagesOf(id).some(message => message.includes(text))).toBe(true)
  await expect.poll(() => sessionEventsOf(id).filter(event => event.type === 'turn/end').length, { timeout: 120_000 }).toBe(before + 1)
  expect(sessionEventsOf(id).findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
}

test('native quotation is hidden by default in a fresh host profile', async ({ page }) => {
  await prepareSeedPage(page)
  await openGeneralSettings(page)
  const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
  await dialog.getByRole('button', { name: 'Sidenote', exact: true }).click()
  await expect(dialog.getByRole('switch', { name: /^(Hide native quote|隐藏原生引用)$/ })).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: 'test-results/sidenote-default-hidden.png' })
  await dialog.getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
  const source = page.locator('[data-conversation-session]').first().locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()
  await dragText(page, source, 'full history snapshot')
  await expect(toolbarOf(page).getByRole('button')).toHaveCount(2)
  await expect(toolbarOf(page).getByRole('button', { name: quoteAction })).toHaveCount(0)
})

for (const real of [false, true]) test(`${real ? 'account Flash ' : ''}native quotation and Sidenote settings stay consistent in main and side`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_ACCOUNT_MODEL, 'Requires an isolated native DeepSeek account')
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  if (real) await page.emulateMedia({ colorScheme: 'dark' })
  await prepareSeedPage(page)
  if (real) {
    await openGeneralSettings(page)
    const settings = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
    await settings.getByRole('button', { name: /^(English|中文)$/ }).click()
    await page.getByRole('menuitem', { name: '中文', exact: true }).click()
    await settings.getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
  }
  await setHidden(page, false)
  const seedId = process.env.DSH_E2E_SEED_SESSION!
  const seedMessages = userMessagesOf(seedId)
  const seed = page.locator(`[data-conversation-session="${seedId}"]`)
  await seed.getByRole('button', { name: /^(Branch into a new conversation|在新对话中分支)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', seedId)
  const mainId = (await main.getAttribute('data-conversation-session'))!
  const model = real ? process.env.DSH_E2E_ACCOUNT_MODEL! : 'Controlled E2E'
  await selectModel(page, main, model)
  // Keep the quoted source outside the native tail page after a cold restart.
  if (!real) {
    for (let index = 0; index < 22; index++) await submit(main, mainId, `Pagination history ${index}`)
  }
  const source = main.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()
  await loadEarlierUntil(main, source)
  await dragText(page, source, 'full history snapshot')
  const toolbar = toolbarOf(page)
  await expect(toolbar.getByRole('button')).toHaveCount(3)
  await expect(page.locator('[data-text-interaction-surface] button')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/sidenote-main-selection.png' })
  await toolbar.getByRole('button', { name: quoteAction }).click()
  await expect(main.locator('[data-composer-quote]')).toHaveCount(1)
  const mainMarker = 'MAIN_QUOTE_' + randomUUID().replaceAll('-', '')
  const mainQuestion = '不要调用工具，只回复这个标记：' + mainMarker
  await submit(main, mainId, mainQuestion, true)
  expect(userMessagesOf(mainId).find(message => message.includes(mainMarker))).toContain('> full history snapshot')
  if (real) await expect(main.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: mainMarker }).last()).toBeVisible()
  await dragText(page, main.locator('[data-chat-flow-kind="user"]').filter({ hasText: mainMarker }).last(), mainMarker)
  await expect(page.locator('[data-text-interaction-surface] button')).toHaveCount(1)
  await expect(toolbar).toHaveCount(0)

  const childId = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, model)
  const inherited = side.getByRole('button', { name: /Main conversation context|主线上下文/ })
  if (await inherited.getAttribute('aria-expanded') === 'false') await inherited.click()
  const inheritedSource = side.locator('[data-sidenote-context-history]').getByText('The fork takes a full history snapshot, so the side chat starts with complete context', { exact: false }).first()
  await dragText(page, inheritedSource, 'full history snapshot')
  await toolbar.getByRole('button', { name: quoteAction }).click()
  await expect(side.locator('[data-composer-quote]')).toHaveCount(1)
  await expect(main.locator('[data-composer-quote]')).toHaveCount(0)
  await side.locator('[data-composer-quote] button').click()
  await inherited.click()
  const sideMarker = 'SIDE_QUOTE_' + randomUUID().replaceAll('-', '')
  await submit(side, childId, '不要调用工具，只回复这个标记：' + sideMarker)
  const sideText = real ? sideMarker : 'complete assistant response'
  const sideSource = side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: sideText }).last()
  await dragText(page, sideSource, sideText)
  await expect(toolbar.getByRole('button')).toHaveCount(2)
  await expect(page.locator('[data-text-interaction-surface] button')).toHaveCount(0)
  await expect(page.getByText(/(?:finished replying|回复完成)$/)).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: 'test-results/sidenote-side-selection.png' })
  await toolbar.getByRole('button', { name: quoteAction }).click()
  await expect(side.locator('[data-composer-quote]')).toHaveCount(1)
  await expect(main.locator('[data-composer-quote]')).toHaveCount(0)

  await setHidden(page, true)
  await expect(side.locator('[data-composer-quote]')).toHaveCount(1)
  await dragText(page, sideSource, sideText)
  await expect(toolbar.getByRole('button', { name: quoteAction })).toHaveCount(0)
  await expect(toolbar.getByRole('button')).toHaveCount(1)
  await toolbar.getByRole('button', { name: addAction }).click()
  const note = '侧边批注_' + randomUUID()
  await page.locator('[data-dsh-sidenote] input').fill(note)
  await page.locator('[data-dsh-sidenote] input').press('Enter')
  await expect(side.getByRole('button', { name: /1 annotation|1 条注释/ })).toBeVisible()
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', childId)
  await expect(side.locator('[data-composer-quote]')).toHaveCount(1)
  await expect(side.getByRole('button', { name: /1 annotation|1 条注释/ })).toBeVisible()
  await restartHost(page)
  await expect(side).toHaveAttribute('data-sidenote-chat-session', childId)
  await expect(side.locator('[data-composer-quote]')).toHaveCount(1)
  await expect(side.getByRole('button', { name: /1 annotation|1 条注释/ })).toBeVisible()
  await openGeneralSettings(page)
  const restoredSettings = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
  await restoredSettings.getByRole('button', { name: 'Sidenote', exact: true }).click()
  await expect(restoredSettings.getByRole('switch', { name: /^(Hide native quote|隐藏原生引用)$/ })).toHaveAttribute('aria-checked', 'true')
  await restoredSettings.getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
  await loadEarlierUntil(main, source)
  await dragText(page, source, 'full history snapshot')
  await expect(toolbar.getByRole('button', { name: quoteAction })).toHaveCount(0)
  await expect(toolbar.getByRole('button')).toHaveCount(2)
  await expect(page.locator('[data-text-interaction-surface] button')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/sidenote-hidden-restored.png' })
  const answerMarker = 'ANNOTATION_QUOTE_' + randomUUID().replaceAll('-', '')
  const question = '确认已读到引用和批注，不要调用工具，只回复这个标记：' + answerMarker
  await submit(side, childId, question, true)
  const sent = userMessagesOf(childId).find(message => message.includes(answerMarker))!
  expect(sent).toContain('> ' + sideText)
  expect(sent).toContain('<note>' + note + '</note>')
  expect(userMessagesOf(mainId).some(message => message.includes(note))).toBe(false)
  if (real) await expect(side.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: answerMarker }).last()).toBeVisible()
  await side.getByRole('button', { name: /^(Bring back to main conversation|带回主对话)$/ }).last().click()
  await expect(main.getByRole('button', { name: /1 side-chat reflow|1 条侧边回流/ })).toBeVisible()
  const returnQuestion = '只复述刚从侧边带回的回答，不要调用工具。'
  await submit(main, mainId, returnQuestion)
  if (real) await expect(main.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: answerMarker }).last()).toBeVisible()
  await page.screenshot({ path: real ? 'test-results/account-native-quote-reflow.png' : 'test-results/native-quote-reflow.png' })
  await setHidden(page, false)
  await dragText(page, side.locator('[data-chat-flow-kind="assistant-step"]').last(), real ? answerMarker : 'complete assistant response')
  await expect(toolbar.getByRole('button', { name: quoteAction })).toBeVisible()
  expect(userMessagesOf(seedId)).toEqual(seedMessages)
  expect(errors).toEqual([])
})

test('native quotation layout stays within main and side at narrow widths', async ({ page }) => {
  await prepareSeedPage(page)
  await setHidden(page, false)
  const main = page.locator('[data-conversation-session]').first()
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  await submit(side, child, 'Produce a complete reply for narrow selection layout')
  await page.setViewportSize({ width: 1000, height: 720 })
  for (const [view, text, name] of [[main, 'full history snapshot', 'main'], [side, 'complete assistant response', 'side']] as const) {
    const source = view.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: text }).last()
    await dragText(page, source, text)
    const toolbar = toolbarOf(page)
    await expect(toolbar.getByRole('button', { name: quoteAction })).toBeVisible()
    const bounds = (await toolbar.boundingBox())!
    const frame = (await view.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(Math.max(0, frame.x))
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(Math.min(1000, frame.x + frame.width))
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(720)
    await page.screenshot({ path: `test-results/sidenote-narrow-${name}.png` })
  }
})
