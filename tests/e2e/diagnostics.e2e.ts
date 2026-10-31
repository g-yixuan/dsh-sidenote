import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { prepareSeedPage, registerSeedWorkspace, openSideChat, sideChatOf, userMessagesOf, openGeneralSettings, dragText } from './journey'

test.beforeAll(registerSeedWorkspace)
const pluginVersion: string = JSON.parse(readFileSync('package.json', 'utf8')).version

const entry = (page: Page) => page.getByRole('button', { name: /^(Compatibility diagnostics|兼容诊断)$/ })
const modeSwitch = (page: Page) => page.getByRole('switch', { name: /^dsh-sidenote (diagnostic mode|诊断模式)$/ })

async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()
  await expect(modeSwitch(page)).not.toBeVisible()
}

async function setDiagnosticMode(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(value => {
    if (value) sessionStorage.setItem('dsh-sidenote:developer-diagnostics', 'true')
    else sessionStorage.removeItem('dsh-sidenote:developer-diagnostics')
  }, enabled)
  await page.reload()
  await expect(page.locator('[data-chat-flow-kind="assistant-step"]').first()).toBeAttached()
  await expect(entry(page)).toHaveCount(enabled ? 1 : 0)
}

test('diagnostics have no user setting and require a developer opt-in confined to this tab', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dsh-sidenote:diagnostics-enabled', 'true'))
  await prepareSeedPage(page)
  await expect(entry(page)).toHaveCount(0)
  await openGeneralSettings(page)
  await expect(modeSwitch(page)).toHaveCount(0)
  await page.screenshot({ path: 'test-results/diagnostics-settings.png' })
  await closeSettings(page)
  await setDiagnosticMode(page, true)
  await entry(page).click()
  const dialog = page.getByRole('dialog', { name: /^(Compatibility diagnostics|兼容诊断)$/ })
  await dialog.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(entry(page)).toBeFocused()
  await page.reload()
  await expect(entry(page)).toBeVisible()
  const other = await page.context().newPage()
  try {
    await prepareSeedPage(other)
    await expect(entry(other)).toHaveCount(0)
  } finally { await other.close() }
  await entry(page).click()
  await setDiagnosticMode(page, false)
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-chat-flow-kind="assistant-step"]').first()).toBeAttached()
  await expect(entry(page)).toHaveCount(0)
  await page.screenshot({ path: 'test-results/diagnostics-disabled.png' })
})

test('unavailable developer storage leaves diagnostics hidden and the normal composer usable', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem
    Storage.prototype.getItem = function(key) {
      if (key === 'dsh-sidenote:developer-diagnostics') throw new DOMException('blocked', 'SecurityError')
      return read.call(this, key)
    }
  })
  await prepareSeedPage(page)
  await expect(entry(page)).toHaveCount(0)
  const input = page.locator('[data-composer-seat] [data-composer-input], [data-composer-seat] textarea').first()
  await input.fill('ordinary draft without diagnostics')
  expect(await input.evaluate(el => el instanceof HTMLTextAreaElement ? el.value : el.textContent)).toBe('ordinary draft without diagnostics')
})

test('compatibility report is visible, observes real admission, and exports software facts only', async ({ page }) => {
  await prepareSeedPage(page)
  await setDiagnosticMode(page, true)
  await page.getByRole('button', { name: /^(Compatibility diagnostics|兼容诊断)/ }).click()
  const dialog = page.getByRole('dialog', { name: /^(Compatibility diagnostics|兼容诊断)$/ })
  await expect(dialog).toContainText(`sidenote ${pluginVersion}`)
  await expect(dialog.getByText(/^(Main input|主输入框)$/)).toBeVisible()
  await dialog.getByRole('button', { name: /^(Close compatibility diagnostics|关闭兼容诊断)$/ }).click()
  const child = await openSideChat(page)
  const input = sideChatOf(page).locator('[data-composer-input]')
  await input.fill('diagnostics ordinary body')
  // Add through the real toolbar; only selected quote data enters the model.
  const body = sideChatOf(page).locator('[data-sidenote-quote-body]').filter({ hasText: 'full history snapshot' }).first()
  await dragText(page, body, 'full history snapshot')
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByRole('button', { name: /^(Add to conversation|添加到对话)$/ }).click()
  await expect(overlay.locator('input')).toBeVisible()
  await overlay.locator('input').press('Enter')
  await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).some(text => text.includes('diagnostics ordinary body') && text.includes('<annotation'))).toBe(true)
  await page.getByRole('button', { name: /^(Compatibility diagnostics|兼容诊断)/ }).click()
  const acceptance = dialog.getByRole('listitem').filter({ hasText: /Side message acceptance|侧聊消息接受/ })
  await expect(acceptance.locator('[data-state]')).toHaveAttribute('data-state', 'available')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^(Export report|导出报告)$/ }).click()
  const file = await download; await file.saveAs('test-results/compatibility.json')
  const json = readFileSync('test-results/compatibility.json', 'utf8')
  expect(json).not.toContain(child)
  expect(json).not.toMatch(/diagnostics ordinary body|token|cookie|\/Users\/|sessionId|dsh-sidenote-e2e\./i)
  await page.screenshot({ path: 'test-results/compatibility-status.png' })
})

if (process.env.DSH_E2E_CAPABILITY_FAULT) test('missing side input is visible, retains body and quote, and recovers through the real facade', async ({ page }) => {
  await prepareSeedPage(page)
  await expect(entry(page)).toHaveCount(0)
  await setDiagnosticMode(page, true)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  const input = side.locator('[data-composer-input]')
  await input.fill('body retained across missing input')
  const body = side.locator('[data-sidenote-quote-body]').filter({ hasText: 'full history snapshot' }).first()
  await dragText(page, body, 'full history snapshot')
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('input').fill('retained quote note'); await overlay.locator('input').press('Enter')
  // Change the real facade after the composer has cached it, then send before
  // the debounced status observer can be relied on to re-render React.
  await page.getByRole('button', { name: 'Simulate missing side input', exact: true }).click()
  await input.press('Enter')
  await expect(side.getByText(/Cannot send right now|The input is not ready|暂时无法发送|输入尚未就绪/)).toBeVisible()
  await expect(input).toHaveText('body retained across missing input')
  const records = () => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), child)
  await expect.poll(records).toMatchObject([{ state: 'active', note: 'retained quote note' }])
  expect(userMessagesOf(child).some(text => text.includes('body retained across missing input'))).toBe(false)
  await page.getByRole('button', { name: /^(Compatibility diagnostics|兼容诊断)/ }).click()
  const dialog = page.getByRole('dialog', { name: /^(Compatibility diagnostics|兼容诊断)$/ })
  await expect(dialog.getByRole('listitem').filter({ hasText: /Side input|侧输入框/ }).locator('[data-state]')).toHaveAttribute('data-state', 'unavailable')
  await dialog.getByRole('button', { name: /^(Close compatibility diagnostics|关闭兼容诊断)$/ }).click()
  await page.getByRole('button', { name: 'Restore native input', exact: true }).click()
  // Recovery must become visible through the normal composer without a
  // diagnostic recheck; submitting while it still says waiting is a retry.
  await expect(side.getByText(/Cannot send right now|The input is not ready|暂时无法发送|输入尚未就绪/)).not.toBeVisible()
  await expect(input).toHaveText('body retained across missing input')
  await input.press('Enter')
  await expect.poll(() => userMessagesOf(child).filter(text => text.includes('body retained across missing input'))).toHaveLength(1)
  await expect.poll(records).toMatchObject([{ state: 'sent' }])
  await entry(page).click()
  await dialog.getByRole('button', { name: /^(Recheck|重新检查)$/ }).click()
  await expect(dialog.getByRole('listitem').filter({ hasText: /Side input|侧输入框/ }).locator('[data-state]')).toHaveAttribute('data-state', 'available')
  await page.screenshot({ path: 'test-results/capability-recovered.png' })
})

if (process.env.DSH_E2E_CAPABILITY_FAULT) test('missing main input cannot silently send only the body while leaving a quote behind', async ({ page }) => {
  await prepareSeedPage(page)
  const parent = process.env.DSH_E2E_SEED_SESSION!
  const source = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()
  await dragText(page, source, 'full history snapshot')
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('input').fill('main quote to retain'); await overlay.locator('input').press('Enter')
  const input = page.locator('[data-composer-seat] [data-composer-input], [data-composer-seat] textarea').first()
  await input.fill('main body blocked with its quote')
  await page.getByRole('button', { name: 'Simulate missing main input', exact: true }).click()
  await input.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: /Cannot send right now|暂时无法发送/ })).toBeVisible()
  expect(userMessagesOf(parent).some(text => text.includes('main body blocked with its quote'))).toBe(false)
  expect(await input.evaluate(el => el instanceof HTMLTextAreaElement ? el.value : el.textContent)).toBe('main body blocked with its quote')
  const records = () => page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), parent)
  await expect.poll(records).toMatchObject([{ state: 'active', note: 'main quote to retain' }])
  await page.getByRole('button', { name: 'Restore main input', exact: true }).click()
  await input.press('Enter')
  await expect.poll(() => userMessagesOf(parent).filter(text => text.includes('main body blocked with its quote') && text.includes('<note>main quote to retain</note>'))).toHaveLength(1)
  await expect.poll(records).toMatchObject([{ state: 'sent' }])
})
