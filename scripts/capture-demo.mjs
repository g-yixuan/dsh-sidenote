/**
 * Demo-asset capture: drive the seeded scratch GUI through the feature
 * journeys and save polished screenshots into docs/assets/ for the README.
 *
 * Usage: boot the scratch env (see scripts/e2e-mount.sh), then
 *   DSH_E2E_URL=http://127.0.0.1:<port> node scripts/capture-demo.mjs
 */
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) throw new Error('DSH_E2E_URL missing')
const OUT = new URL('../docs/assets/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } })

async function shot(name) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}${name}.png` })
  console.log('captured', name)
}

async function dismissOnboarding(p) {
  for (let round = 0; round < 8; round++) {
    let dismissed = false
    for (const name of ['Continue', 'Configure later']) {
      const b = p.getByRole('button', { name, exact: true }).first()
      if ((await b.count()) === 0) continue
      try { await b.click({ timeout: 3000 }); dismissed = true; await p.waitForTimeout(800) } catch {}
    }
    if (!dismissed) break
  }
}

async function ensureSidebarExpanded(p) {
  const expand = p.getByRole('button', { name: /Expand sidebar/ }).first()
  if ((await expand.count()) > 0) { await expand.click(); await p.waitForTimeout(800) }
}

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await dismissOnboarding(page)

// 打开伪造会话
const openSidebar = page.getByRole('button', { name: 'Open sidebar' }).first()
if ((await openSidebar.count()) > 0) { await openSidebar.click(); await page.waitForTimeout(800) }
const seedRow = page.getByText('Side chat plugin review').first()
await seedRow.waitFor({ state: 'visible', timeout: 30_000 })
await seedRow.click()
await page.waitForTimeout(2000)

// 1. 划选浮层
await page.evaluate(() => {
  const messages = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
  for (const el of messages) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      const needle = 'full history snapshot'
      const at = text.indexOf(needle)
      if (at === -1) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      const sel = window.getSelection()
      sel?.removeAllRanges(); sel?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return
    }
  }
})
const overlay = page.locator('[data-dsh-sidenote]')
await overlay.getByText('Add to conversation').waitFor({ state: 'visible', timeout: 10_000 })
await shot('01-selection-popover')

// 2. 注解编辑器
await overlay.getByText('Add to conversation').click()
await page.waitForTimeout(400)
const noteInput = overlay.locator('input').first()
await noteInput.fill('watch the memory cost')
await shot('02-annotation-editor')

// 3. 角标 + chip
await overlay.locator('button[aria-label="Save note"]').click()
await page.getByText('1 annotation').first().waitFor({ state: 'visible', timeout: 10_000 })
// 角标在 gutter，滚到锚点可见
await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if ((n.textContent ?? '').includes('full history snapshot')) {
      n.parentElement?.scrollIntoView({ block: 'center' })
      return
    }
  }
})
await shot('03-badge-and-chip')

// 4. 发送携带（Enter 拦截 → 协议块随消息发出 → 气泡留痕标签）。
//    无模型环境 turn 会报错——只截气泡本体，避开下方的错误行。
const composer = page.getByRole('textbox', { name: /Message the agent|输入消息|随心输入/ }).first()
await composer.click()
await composer.pressSequentially('looks good to me — ship it with these noted', { delay: 10 })
await page.keyboard.press('Enter')
const sentBubble = page.locator('[data-chat-flow-kind="user"]', { hasText: 'looks good to me' }).last()
await sentBubble.waitFor({ state: 'visible', timeout: 10_000 })
await page.waitForTimeout(400)
await sentBubble.screenshot({ path: `${OUT}05-sent-trace.png` })
console.log('captured 05-sent-trace')

// 5. 侧边聊天面板（fork 历史 + 独立 composer）
await ensureSidebarExpanded(page)
const sidebar = page.locator('[data-dsh-better-sidebar]')
await sidebar.getByRole('button', { name: /New tab/ }).first().click()
await page.getByRole('menuitem', { name: /Side chat/ }).first().click()
await sidebar.getByText(/full history snapshot/).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 60_000 })
await page.waitForTimeout(1200)
await shot('04-side-chat-panel')

// 6. 回流：hover 侧边面板 assistant 消息 → 点回流 → 主输入框上方 chip。
const sideMsg = sidebar.locator('[class*="_assistantRow"]').last()
await sideMsg.hover()
const reflowBtn = sidebar.locator('button[aria-label="Send back to main session"]').last()
await reflowBtn.waitFor({ state: 'visible', timeout: 5_000 })
await reflowBtn.click()
await page.getByText(/side-chat reflow/).first().waitFor({ state: 'visible', timeout: 10_000 })
await page.waitForTimeout(400)
await shot('06-reflow-chip')

await browser.close()
console.log('demo assets written to docs/assets/')
