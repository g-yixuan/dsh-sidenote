/* Full-journey probe with localStorage dumps at each step (debug the restore path). */
import { chromium } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) throw new Error('DSH_E2E_URL missing')

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

const dump = async (label) => {
  const all = await page.evaluate(() => Object.keys(localStorage).map((k) => `${k}=>${(localStorage.getItem(k) ?? '').length}c`))
  console.log(`[${label}]`, JSON.stringify(all))
  for (const k of await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('sidebar')))) {
    const v = await page.evaluate((key) => localStorage.getItem(key), k)
    console.log(`[${label}] ${k} =>`, (v ?? '').slice(0, 400))
  }
}

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
for (const name of ['Continue', 'Configure later']) {
  const b = page.getByRole('button', { name, exact: true }).first()
  if ((await b.count()) > 0) { try { await b.click({ timeout: 3000 }) } catch {} await page.waitForTimeout(800) }
}
await dump('boot')

// open left nav and click the seeded session
const openSidebar = page.getByRole('button', { name: 'Open sidebar' }).first()
if ((await openSidebar.count()) > 0) { await openSidebar.click(); await page.waitForTimeout(800) }
const seedRow = page.getByText('E2E 蓝鲸种子会话').first()
console.log('seedRow count:', await seedRow.count())
await seedRow.click()
await page.waitForTimeout(2000)
await dump('seed-open')

// open side chat via + menu
const sidebar = page.locator('[data-dsh-better-sidebar]')
await sidebar.getByRole('button', { name: /New tab/ }).first().click()
await page.waitForTimeout(500)
const item = page.getByRole('menuitem', { name: /侧边聊天/ }).first()
console.log('menu item count:', await item.count())
await item.click()
// wait for fork + history render
await page.waitForTimeout(8000)
const hasHistory = await sidebar.getByText(/蓝鲸预算/).count()
console.log('side chat history visible:', hasHistory)
await dump('sidechat-open')

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
for (const name of ['Continue', 'Configure later']) {
  const b = page.getByRole('button', { name, exact: true }).first()
  if ((await b.count()) > 0) { try { await b.click({ timeout: 3000 }) } catch {} await page.waitForTimeout(800) }
}
await dump('after-reload')
const sidebarAfter = page.locator('[data-dsh-better-sidebar]')
console.log('after reload — 侧边 tab count:', await sidebarAfter.getByText('侧边').count(), '| history visible:', await sidebarAfter.getByText(/蓝鲸预算/).count())
await page.screenshot({ path: 'test-results/probe-after-reload.png' })

await browser.close()
