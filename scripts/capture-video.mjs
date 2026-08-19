/**
 * Demo video capture: record the feature loop (selection → popover → editor →
 * badge + chip → side chat) as a webm video via Playwright's recordVideo.
 * Convert to mp4 afterwards (ffmpeg).
 *
 * Usage: boot the scratch env, then
 *   DSH_E2E_URL=http://127.0.0.1:<port> node scripts/capture-video.mjs
 * Output: test-results/video/<uuid>/video.webm → docs/assets/demo.mp4
 */
import { mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) throw new Error('DSH_E2E_URL missing')
const VIDEO_DIR = 'test-results/video'
mkdirSync(VIDEO_DIR, { recursive: true })
mkdirSync('docs/assets', { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
})
const page = await context.newPage()

const pause = (ms) => page.waitForTimeout(ms)

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
// onboarding
for (let round = 0; round < 8; round++) {
  let dismissed = false
  for (const name of ['Continue', 'Configure later']) {
    const b = page.getByRole('button', { name, exact: true }).first()
    if ((await b.count()) === 0) continue
    try { await b.click({ timeout: 3000 }); dismissed = true; await page.waitForTimeout(800) } catch {}
  }
  if (!dismissed) break
}

// 打开伪造会话
const openSidebar = page.getByRole('button', { name: 'Open sidebar' }).first()
if ((await openSidebar.count()) > 0) { await openSidebar.click(); await pause(800) }
const seedRow = page.getByText('Side chat plugin review').first()
await seedRow.waitFor({ state: 'visible', timeout: 30_000 })
await seedRow.click()
await pause(1500)

// 划选 → 浮层
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
const overlay = page.locator('[data-dsh-sidechat]')
await overlay.getByText('Add to conversation').waitFor({ state: 'visible', timeout: 10_000 })
await pause(1200)

// 编辑器
await overlay.getByText('Add to conversation').click()
await pause(600)
const noteInput = overlay.locator('input').first()
await noteInput.click()
await noteInput.pressSequentially('watch the memory cost', { delay: 50 })
await pause(800)
await overlay.locator('button[aria-label="Save note"]').click()
await page.getByText('1 annotation').first().waitFor({ state: 'visible', timeout: 10_000 })
await pause(1500)

// 侧边聊天
const expand = page.getByRole('button', { name: /Expand sidebar/ }).first()
if ((await expand.count()) > 0) { await expand.click(); await pause(800) }
const sidebar = page.locator('[data-dsh-better-sidebar]')
await sidebar.getByRole('button', { name: /New tab/ }).first().click()
await page.getByRole('menuitem', { name: /Side chat/ }).first().click()
await sidebar.getByText(/full history snapshot/).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 60_000 })
await pause(1500)

await context.close()
await browser.close()

// webm → mp4
const dir = readdirSync(VIDEO_DIR)
const webm = dir.find((f) => f.endsWith('.webm'))
if (webm) {
  const src = join(VIDEO_DIR, webm)
  const dst = 'docs/assets/demo.mp4'
  try {
    execFileSync('ffmpeg', ['-y', '-i', src, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', dst], { stdio: 'inherit' })
    console.log('demo video →', dst)
  } catch (error) {
    console.warn('ffmpeg 不可用，保留 webm：', src)
  }
}
