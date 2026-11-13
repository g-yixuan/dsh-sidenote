import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const stylesheet = readFileSync('src/client/sidechat/sidechat.module.css', 'utf8')

// Use Chromium: jsdom 30 drops font longhands following `font: inherit`.
for (const fontSize of [14, 16]) {
  test(`侧边按钮样式：父容器 ${fontSize}px 时保持紧凑`, async ({ page }) => {
    await page.setContent(`
      <style>${stylesheet}</style>
      <div style="font-size: ${fontSize}px; line-height: 28px">
        <button class="headerSide"><span>侧边</span></button>
      </div>
    `)

    const button = page.getByRole('button', { name: '侧边' })
    await expect(button.locator('..')).toHaveCSS('font-size', `${fontSize}px`)
    await expect(button).toHaveCSS('font-size', '13px')
    await expect(button).toHaveCSS('line-height', '20px')
    await expect(button.locator('span')).toHaveCSS('font-size', '13px')
    await expect(button).toHaveCSS('height', '28px')
  })
}
