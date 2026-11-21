/**
 * 无-BS 直连档：原生宿主 + 不装 better-sidebar——
 * 验证 optional peer 后的主路径：插件激活（无 cordis inject 门禁崩溃）、
 * 顶栏入口开 tab、面板渲染（seed 会话
 * 必须实际 fork 出 child、加载历史并提供可用输入框）。
 *
 * 由 e2e-mount.sh 在 BS_VERSION=none 时调用（本 spec 不依赖 BS 的 DOM 面）。
 */
import { test, expect } from '@playwright/test'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, sideChatOf } from './journey'

test.beforeAll(registerSeedWorkspace)

test('侧聊入口和工具栏使用宿主提示，禁用时仍能悬停查看原因', async ({ page }) => {
  await prepareSeedPage(page)
  const header = page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first()
  const tooltip = page.getByRole('tooltip')
  await expect(header).not.toHaveAttribute('title')
  await header.hover()
  await expect(tooltip).toHaveText(/Open a side chat|打开侧边聊天/)
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  await header.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(tooltip).toHaveText(/Open a side chat|打开侧边聊天/)
  await header.press('Tab')
  await expect(tooltip.filter({ hasText: /Open a side chat|打开侧边聊天/ })).toHaveCount(0)

  await openSideChat(page)
  const side = sideChatOf(page)
  const reflow = side.getByRole('button', { name: /^(Reflow all|整段回流)$/ })
  const save = side.getByRole('button', { name: /^(Save as session|保存为正式会话)$/ })
  await expect(reflow).toBeDisabled()
  await expect(reflow).not.toHaveAttribute('title')
  await reflow.locator('..').hover()
  await expect(tooltip).toHaveText(/Bring all Q&A pairs|把该侧聊全部问答对/)
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  await expect(save).not.toHaveAttribute('title')
  await expect(save).toBeEnabled()
  await save.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(tooltip).toHaveText(/Fork this side chat into|把侧边聊天转为/)
  await side.locator('[data-composer-input]').fill('Keep this unsent draft')
  await expect(save).toBeDisabled()
  await save.locator('..').hover()
  await expect(tooltip).toHaveText(/Send or clear the draft|发送或清除草稿/)
  const bounds = await tooltip.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: 'test-results/side-toolbar-tooltip-disabled.png' })
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  await side.locator('[data-composer-input]').fill('')
  await expect(save).toBeEnabled()
})

test('顶栏侧边按钮在宿主大字号下保持紧凑', async ({ page }) => {
  await prepareSeedPage(page)
  const button = page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first()
  await expect(button).toBeVisible()
  await button.evaluate(element => {
    element.parentElement!.style.fontSize = '16px'
    element.parentElement!.style.lineHeight = '28px'
  })

  await expect(button.locator('..')).toHaveCSS('font-size', '16px')
  await expect(button).toHaveCSS('font-size', '13px')
  await expect(button).toHaveCSS('line-height', '20px')
  await expect(button.locator('span')).toHaveCSS('font-size', '13px')
  await expect(button.locator('svg')).toHaveCSS('width', '13px')
  await expect(button.locator('svg')).toHaveCSS('height', '13px')
  await page.screenshot({ path: 'test-results/header-side-font.png' })
})

test('无-BS 直连档：真实 fork、历史与输入框就绪，无插件崩溃', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(String(error)); console.error('Browser error:', String(error)) })
  page.on('console', (message) => {
    if (message.type() === 'error') { consoleErrors.push(message.text()); console.error('Browser console:', message.text()) }
  })

  await prepareSeedPage(page)
  await expect(page.getByText('Failed to load plugins')).toHaveCount(0)
  await openSideChat(page)

  // 原生右栏开出「侧边」tab（标题槽活标题；实际 child、继承历史、输入框已由共用 helper 验证）。
  const sideTab = page.getByRole('tab', { name: /^(Side|侧边)/ }).first()
  await expect(sideTab, '侧边 tab 未出现——直连注册/编排未生效').toBeAttached({ timeout: 30_000 })

  // 插件级崩溃标记零容忍（连接类 warning 不在此列）。
  expect(pageErrors, 'pageerrors').toEqual([])
  expect(consoleErrors.filter(t => /dsh-sidenote/.test(t)), 'plugin console errors').toEqual([])
})
