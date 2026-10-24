/**
 * 无-BS 直连档：原生宿主 + 不装 better-sidebar——
 * 验证 optional peer 后的主路径：插件激活（无 cordis inject 门禁崩溃）、
 * 顶栏入口开 tab、面板渲染（seed 会话
 * 必须实际 fork 出 child、加载历史并提供可用输入框）。
 *
 * 由 e2e-mount.sh 在 BS_VERSION=none 时调用（本 spec 不依赖 BS 的 DOM 面）。
 */
import { test, expect } from '@playwright/test'
import { openSideChat, prepareSeedPage, registerSeedWorkspace } from './journey'

test.beforeAll(registerSeedWorkspace)

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
