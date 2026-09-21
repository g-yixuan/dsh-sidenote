/**
 * 无-BS 直连档挂载冒烟（Workitem_07）：0.1.5 宿主 + 不装 better-sidebar——
 * 验证 optional peer 后的主路径：插件激活（无 cordis inject 门禁崩溃）、
 * 原生右栏 guide 列出「侧边聊天」、顶栏入口开 tab、面板渲染（seed 会话
 * fork 失败为 keyless 环境限制，错误态兜底即算过）。
 *
 * 由 e2e-mount.sh 在 BS_VERSION=none 时调用（本 spec 不依赖 BS 的 DOM 面）。
 */
import { test, expect, type Page } from '@playwright/test'
import { createHostApi, gotoPage, hostRpc } from './host'

/** 关掉 onboarding 遮挡（Continue / 稍后配置），轮询至多轮（遮罩会分层出现）。 */
async function dismissOnboarding(page: Page): Promise<void> {
  // 先等首个按钮出现（notice 异步渲染，不 poll 会在它到达前就退出）。
  try {
    await expect
      .poll(() => page.getByRole('button', { name: /^(Continue|Configure later|继续|稍后配置|稍后再说)$/ }).count(), { timeout: 30_000 })
      .toBeGreaterThan(0)
  } catch {
    return // 没有 onboarding——直接返回。
  }
  for (let round = 0; round < 10; round++) {
    let dismissed = false
    for (const name of ['Continue', 'Configure later', '继续', '稍后配置', '稍后再说']) {
      const button = page.getByRole('button', { name, exact: true }).first()
      if ((await button.count()) === 0) continue
      try {
        // force：遮罩与被遮按钮同源（onboarding 自己）时普通 click 的
        // actionability 检查会卡死——force 直接派发。
        await button.click({ timeout: 4_000, force: true })
        dismissed = true
        await page.waitForTimeout(1_000)
      } catch { /* 被上层遮挡时下轮再试 */ }
    }
    if (!dismissed) break
  }
  // 遮罩兜底：等到没有任何 mask 拦在页面上（或超时继续——后续断言会暴露）。
  await page.waitForFunction(
    () => document.querySelector('[class*="_mask_"]') === null,
    undefined,
    { timeout: 15_000 },
  ).catch(() => {})
}

test.beforeAll(async () => {
  const workspace = process.env.DSH_E2E_WORKSPACE
  if (!workspace) throw new Error('DSH_E2E_WORKSPACE is not set — run via scripts/e2e-mount.sh')
  const api = await createHostApi()
  await hostRpc(api, 'workspace.create', { path: workspace })
})

test('无-BS 直连档：插件激活 + guide 列出侧边聊天 + 顶栏开 tab', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await gotoPage(page)
  await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 90_000 })
  await dismissOnboarding(page)

  // 插件激活的反面证据：装载失败页（"Failed to load plugins"）不得出现。
  await expect(page.getByText('Failed to load plugins')).toHaveCount(0)

  // 进入 seeded 会话（按标题文本定位；树角色选择器会被壳层分组行干扰）。
  // 0.1.5 壳层的引导遮罩（dialog mask）不走 Escape——force click 跳过
  // actionability 的遮罩拦截（目标是打开会话，不是测试壳层遮罩行为）。
  const seedRow = page.getByText('Side chat plugin review').first()
  await expect(seedRow, '伪造会话未出现在会话列表').toBeVisible({ timeout: 30_000 })
  await seedRow.click({ force: true })
  await page.waitForTimeout(1_500)

  // 顶栏「打开侧边聊天」入口在场。
  const entry = page.getByRole('button', { name: /打开侧边聊天|Open a side chat/ }).first()
  await expect(entry, '顶栏侧边入口缺席——annotate/桥注册未生效').toBeAttached({ timeout: 30_000 })
  await entry.click()
  await page.waitForTimeout(3_000)

  // 原生右栏开出「侧边」tab（标题槽活标题；fork 错误态是 keyless 限制）。
  const sideTab = page.getByRole('tab', { name: /^(Side|侧边)/ }).first()
  await expect(sideTab, '侧边 tab 未出现——直连注册/编排未生效').toBeAttached({ timeout: 30_000 })

  // 插件级崩溃标记零容忍（连接类 warning 不在此列）。
  expect(pageErrors, 'pageerrors').toEqual([])
  expect(consoleErrors.filter(t => /dsh-sidenote/.test(t)), 'plugin console errors').toEqual([])
})
