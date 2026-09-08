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
// 关掉首次划选提示气泡（role=note 的 ×），别让它飘进录屏。
const hintClose = page.locator('[role="note"] button').first()
if ((await hintClose.count()) > 0) { await hintClose.click().catch(() => {}); await pause(300) }

// 划选 → 浮层——先把目标文本滚进视口中央再选（插件锚定 range 实时矩形；
// 文本在视口外时浮层贴顶缘——录制事故根因）。
// 提示气泡在消息渲染后才出现，开场那一次关闭可能竞态落空——划选前再关一次。
const hintClose2 = page.locator('[role="note"] button').first()
if ((await hintClose2.count()) > 0) { await hintClose2.click().catch(() => {}); await pause(300) }
await page.evaluate(() => {
  const messages = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
  for (const el of messages) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      const at = text.indexOf('full history snapshot')
      if (at === -1) continue
      ;(node.parentElement ?? el).scrollIntoView({ block: 'center' })
      return
    }
  }
})
await pause(800)
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

// 发送携带的「气泡留痕」拍不进视频：无模型环境 Enter 后主区会留下
// turn 报错行，污染后续镜头；该卖点由静态图 05-sent-trace 承载。
// 视频的注释拍停在 composer 的「1 annotation」chip（上方已等待其可见）。

// 侧边聊天
const expand = page.getByRole('button', { name: /Expand sidebar/ }).first()
if ((await expand.count()) > 0) { await expand.click(); await pause(800) }
const sidebar = page.locator('[data-dsh-better-sidebar]')
await sidebar.getByRole('button', { name: /New tab/ }).first().click()
await page.getByRole('menuitem', { name: /Side chat/ }).first().click()
// D1 折叠卡先亮相（默认折叠 = 新 UI 的卖点之一），再展开历史。
const foldCard = sidebar.locator('[data-disclosure-row]', { hasText: /Inherited from main session|继承自主会话/ }).filter({ visible: true }).first()
await foldCard.waitFor({ state: 'visible', timeout: 60_000 })
await pause(1200)
await foldCard.click()
await sidebar.getByText(/full history snapshot/).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15_000 })
await pause(1500)
// 滚到面板底部：展示新 UI 家族（思考行首行预览 / Bash 人话标题 /
// todo 任务卡——种子 turn 4 在继承区尾部）。
await sidebar.locator('[data-disclosure-row]').last().scrollIntoViewIfNeeded()
await pause(1200)

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
