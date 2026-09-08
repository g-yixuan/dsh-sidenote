import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const light = readFileSync('docs/assets/wordmark-light.svg', 'utf8')
const dark = readFileSync('docs/assets/wordmark-dark.svg', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 260 } })
await page.setContent(`<body style="margin:0">
<div style="background:#fff;padding:20px">${light}</div>
<div style="background:#0d1117;padding:20px">${dark}</div>
</body>`)
await page.screenshot({ path: '/tmp/wordmark-preview.png' })
await browser.close()
console.log('ok')
