import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const svg = readFileSync('/tmp/logo-draft.svg', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 600, height: 400 } })
await page.setContent(`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#f5f6f8;gap:32px">
<div style="width:192px;height:192px">${svg.replace('width="128" height="128"', 'width="192" height="192"')}</div>
<div style="width:48px;height:48px">${svg.replace('width="128" height="128"', 'width="48" height="48"')}</div>
<div style="width:96px;height:96px;border-radius:22px;overflow:hidden">${svg.replace('width="128" height="128"', 'width="96" height="96"')}</div>
</body>`)
await page.screenshot({ path: '/tmp/logo-preview.png' })
await browser.close()
console.log('ok')
