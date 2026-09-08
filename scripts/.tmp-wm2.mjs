import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const svg = readFileSync('docs/assets/wordmark-light.svg', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 700, height: 140 } })
await page.setContent(`<body style="margin:0;background:#fff;padding:20px">${svg}</body>`)
await page.screenshot({ path: '/tmp/wm-new.png' })
await browser.close()
console.log('ok')
