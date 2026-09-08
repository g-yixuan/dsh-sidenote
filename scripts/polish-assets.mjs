#!/usr/bin/env node
/**
 * README 截图烘焙：圆角 + 边框 + 柔和投影 + 透明边距（烧进 PNG 本身——
 * GitHub README 无自定义 CSS；透明底在明/暗主题下都成立）。
 *
 * 用 Playwright 渲染 + omitBackground 截图（不引入 PIL 等原生依赖）。
 * 就地覆盖 docs/assets/*.png（重复跑幂等——先 git 里恢复原图再重跑）。
 *
 * 用法：node scripts/polish-assets.mjs
 */
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'assets')
const MARGIN = 24

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

for (const name of readdirSync(ASSETS).filter(f => f.endsWith('.png') && !f.startsWith('banner'))) {
  const path = join(ASSETS, name)
  const dataUrl = `data:image/png;base64,${readFileSync(path).toString('base64')}`
  await page.setContent(`<body style="margin:0;background:transparent">
  <div style="display:inline-block;padding:${MARGIN}px">
    <img src="${dataUrl}" style="display:block;border-radius:10px;border:1px solid rgba(48,54,61,0.55);box-shadow:0 6px 18px rgba(0,0,0,0.18)">
  </div>
</body>`)
  const wrap = page.locator('div').first()
  await wrap.screenshot({ path, omitBackground: true })
  console.log('polished', name)
}
await browser.close()
console.log('done')
