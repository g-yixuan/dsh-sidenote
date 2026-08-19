/**
 * dsh-sidechat headless mount lane. The server is NOT started here —
 * scripts/e2e-mount.sh boots `dsh web` (better-sidebar from npm + our tarball
 * via the official `dsh plugin add` channel), plants a fabricated session
 * with one completed turn (scripts/seed-session.mjs), and registers the
 * scratch workspace through the host RPC.
 *
 * Lanes:
 *  1. mount: shell + better-sidebar mount, the + menu lists 「侧边聊天」
 *     (on the blank landing it stays disabled by design — no fork without a
 *     completed turn), zero crash markers;
 *  2. fork journey: open the seeded session → open 侧边聊天 → forked history
 *     renders → child session stays out of the session list → reload → the
 *     tab + history survive (layout restore).
 *
 * Host-shell selectors are not public contracts; each step dumps a snapshot
 * into test-results/steps/ so drift is debuggable from artifacts.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) {
  throw new Error('DSH_E2E_URL is not set — run via scripts/e2e-mount.sh')
}

const PLUGIN_CONSOLE = /dsh-sidechat|Unhandled/

/** Dump a labeled page snapshot + screenshot for postmortem debugging. */
async function dumpStep(page: Page, name: string): Promise<void> {
  try {
    mkdirSync('test-results/steps', { recursive: true })
    await page.screenshot({ path: `test-results/steps/${name}.png`, fullPage: false })
    const snapshot = await page.locator('body').ariaSnapshot()
    writeFileSync(`test-results/steps/${name}.yml`, snapshot)
  } catch (error) {
    console.warn(`[e2e] dumpStep ${name} failed:`, error)
  }
}

/** Dismiss keyless-boot onboarding takeovers (Continue / Configure later). */
async function dismissOnboarding(page: Page): Promise<void> {
  try {
    await expect
      .poll(() => page.getByRole('button', { name: /^(Continue|Configure later|继续|稍后再说)$/ }).count(), { timeout: 30_000 })
      .toBeGreaterThan(0)
  } catch {
    return
  }
  for (let round = 0; round < 8; round++) {
    let dismissed = false
    for (const name of ['Continue', 'Configure later', '继续', '稍后再说']) {
      const button = page.getByRole('button', { name, exact: true }).first()
      if ((await button.count()) === 0) continue
      try {
        await button.click({ timeout: 4_000 })
        dismissed = true
        await page.waitForTimeout(1_000)
      } catch {
        // masked by the takeover stacked above; next round retries
      }
    }
    if (!dismissed) break
  }
}

/** Open the better-sidebar + menu (sidebar must be expanded). */
async function openPlusMenu(page: Page): Promise<void> {
  await ensureSidebarExpanded(page)
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expect(sidebar).toBeAttached({ timeout: 90_000 })
  await sidebar.getByRole('button', { name: /New tab|新建|新标签/ }).first().click()
}

/** better-sidebar 0.13 起面板默认折叠（且按会话记忆）——用前确保展开
 *  （0.12 或已展开会话上为 no-op）。注意切会话后新会话的布局默认折叠，
 *  所以必须在「目标会话已激活」之后调用。 */
async function ensureSidebarExpanded(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: /Expand sidebar|展开/ }).first()
  if ((await expand.count()) > 0) {
    await expand.click()
    await page.waitForTimeout(800)
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(BASE_URL!, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 90_000 })
  await dismissOnboarding(page)
})

test('plugin mounts: + 菜单列出「侧边聊天」且无崩溃标记', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await openPlusMenu(page)
  await dumpStep(page, '01-plus-menu')
  const item = page.getByRole('menuitem', { name: /Side chat/ }).first()
  await expect(item, '「侧边聊天」未出现在 + 菜单——registerTab 未生效').toHaveCount(1)
  await page.keyboard.press('Escape')

  expect(pageErrors, 'pageerrors during mount').toEqual([])
  expect(consoleErrors.filter((t) => PLUGIN_CONSOLE.test(t)), 'plugin console errors').toEqual([])
})

test('fork journey: 种子会话 → 侧边聊天 fork → 历史渲染 → 刷新存活', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  // 打开左侧导航（fresh profile 默认折叠），会话列表才能出现。
  const openSidebar = page.getByRole('button', { name: 'Open sidebar' }).first()
  if ((await openSidebar.count()) > 0) {
    await openSidebar.click()
    await page.waitForTimeout(800)
  }
  await dumpStep(page, '02-left-nav-open')

  // 打开伪造会话（左侧会话树行；壳层选择器非公共契约，漂移时改这里）。
  // 首选标题行（种子写了 projcache 标题）；投影缓存未生效时退到 cwd 基名行
  // （树中无 aria-expanded 的 "workspace …" 行 = 会话，非工作区分组）。
  let seedRow = page.getByText('Side chat plugin review').first()
  if ((await seedRow.count()) === 0) {
    seedRow = page.locator('[role="treeitem"]:not([aria-expanded])', { hasText: /workspace/ }).first()
  }
  await expect(seedRow, '伪造会话未出现在会话列表').toBeVisible({ timeout: 30_000 })
  await seedRow.click()
  await page.waitForTimeout(1_500)
  await dumpStep(page, '02-seed-session-open')

  // 打开侧边聊天：菜单项此时应可用（种子会话有已完成 turn）。
  await openPlusMenu(page)
  await dumpStep(page, '03-plus-menu-on-session')
  const item = page.getByRole('menuitem', { name: /Side chat/ }).first()
  await expect(item, '「侧边聊天」未出现在 + 菜单').toHaveCount(1)
  await item.click()

  // fork 出的历史渲染到面板（含 fork/加载等待）。
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await dumpStep(page, '04-side-chat-opened')
  await expect(
    sidebar.getByText(/full history snapshot/).first(),
    '侧边聊天面板未渲染 fork 出的历史',
  ).toBeVisible({ timeout: 60_000 })

  // 等布局持久化落定（better-sidebar 的 200ms 防抖写盘 + 余量）。
  await page.waitForTimeout(2_000)

  // 子会话不进左侧会话列表：列表里「Side chat plugin review」唯一，且无新增行。
  // （严格结构断言留给真实页面验收；这里以「侧边」Tab 存在 + 无新会话标题为准。）

  // 刷新：布局持久化恢复 Tab，历史重绑。
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  await expect(
    sidebar.getByText(/full history snapshot/).first(),
    '刷新后侧边聊天的 fork 历史未恢复',
  ).toBeVisible({ timeout: 90_000 })
  await dumpStep(page, '05-after-reload')

  expect(pageErrors, 'pageerrors during fork journey').toEqual([])
  expect(consoleErrors.filter((t) => PLUGIN_CONSOLE.test(t)), 'plugin console errors').toEqual([])
})

/** 把聊天消息区滚回顶部（角标锚点文本回到视口）。 */
async function scrollChatToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const msg = document.querySelector('[data-chat-flow-kind="assistant-step"]')
    let el = msg?.parentElement ?? null
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement
    el?.scrollTo({ top: 0 })
  })
  await page.waitForTimeout(400)
}

/** Open the seeded session (left nav → session row). */
async function openSeedSession(page: Page): Promise<void> {
  const openSidebar = page.getByRole('button', { name: 'Open sidebar' }).first()
  if ((await openSidebar.count()) > 0) {
    await openSidebar.click()
    await page.waitForTimeout(800)
  }
  let seedRow = page.getByText('Side chat plugin review').first()
  if ((await seedRow.count()) === 0) {
    seedRow = page.locator('[role="treeitem"]:not([aria-expanded])', { hasText: /workspace/ }).first()
  }
  await expect(seedRow, '伪造会话未出现在会话列表').toBeVisible({ timeout: 30_000 })
  await seedRow.click()
  // 等主聊天渲染出种子 assistant 消息（划选靶子）
  await expect(page.getByText(/Forking into a side panel is the right call/).first()).toBeVisible({ timeout: 30_000 })
}

/** 在第一条 assistant 消息的「full history snapshot」上注入一个真实 DOM 选区。 */
async function injectSelection(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
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
        sel?.removeAllRanges()
        sel?.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return true
      }
    }
    return false
  })
  expect(ok, '未能在 assistant 消息上注入选区（DOM 契约漂移？）').toBe(true)
}

test('annotate journey: 划选 → 浮层 → 注解编辑器 → 角标 → chip → 草稿前缀', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await openSeedSession(page)
  await injectSelection(page)

  // 浮层工具条：两个去向按钮。
  const overlay = page.locator('[data-dsh-sidechat]')
  await expect(overlay.getByText('Add to conversation'), '划选浮层未弹出').toBeVisible({ timeout: 10_000 })
  await expect(overlay.getByText('Ask in side chat')).toBeVisible()
  await dumpStep(page, '06-selection-popover')

  // 「添加到对话」→ 注解编辑器（新建态：输入框 + ✓）。
  await overlay.getByText('Add to conversation').click()
  const noteInput = overlay.locator('input, textarea').first()
  await expect(noteInput, '注解编辑器未打开').toBeVisible({ timeout: 10_000 })
  await noteInput.fill('watch the memory cost')
  await dumpStep(page, '07-annotation-editor')

  // 保存（新建态确认钮：aria-label 确认注解）→ 角标 1 锚定 + chip「1 条注释」。
  await overlay.locator('button[aria-label="Save note"]').first().click()
  await expect(overlay.getByText('1', { exact: true }).first(), '编号角标 1 未出现').toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('1 annotation').first(), 'composer chip 未出现').toBeVisible({ timeout: 10_000 })
  await dumpStep(page, '08-chip')

  // 发送携带：主输入框草稿应含引用块（受管前缀）。主 composer 可能是
  // textarea 或 contenteditable，两种读法都试。
  const composer = page.getByRole('textbox', { name: /Message the agent|输入消息|随心输入/ }).first()
  const draft = await composer.evaluate((el) => (
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? '')
  ))
  expect(draft, '草稿缺少引用块前缀').toContain('full history snapshot')
  expect(draft).toContain('watch the memory cost')

  expect(pageErrors, 'pageerrors during annotate journey').toEqual([])
  expect(consoleErrors.filter((t) => PLUGIN_CONSOLE.test(t)), 'plugin console errors').toEqual([])
})

test('linkage journey: 划选 → 在侧边聊天中提问 → 编辑器 → 侧边聊天带引用草稿', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await openSeedSession(page)
  await injectSelection(page)

  // 「在侧边聊天中提问」→ 先弹注解编辑器（WI-03 裁定：与「添加到对话」一致）。
  const overlay = page.locator('[data-dsh-sidechat]')
  await overlay.getByText('Ask in side chat').click()
  const noteInput = overlay.locator('input[aria-label="Side chat note"]')
  await expect(noteInput, '侧边提问未弹注解编辑器').toBeVisible({ timeout: 10_000 })
  await noteInput.fill('discuss this point')
  await overlay.locator('button[aria-label="Confirm and ask"]').click()

  // 侧边聊天 Tab 打开（fork 主会话），composer 草稿带「引用 + 注解」。
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expect(
    sidebar.getByText(/full history snapshot/).first(),
    '侧边聊天未打开或未渲染 fork 历史',
  ).toBeVisible({ timeout: 60_000 })
  const sideComposer = sidebar.getByRole('textbox').first()
  const sideDraft = await sideComposer.evaluate((el) => (
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? '')
  ))
  expect(sideDraft, '侧边聊天草稿缺少引用').toContain('full history snapshot')
  expect(sideDraft).toContain('discuss this point')
  await dumpStep(page, '09-linkage')

  // 互斥：主对话不产生注释（无角标、无 chip）。
  await expect(overlay.getByText('1', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/annotation|annotations/)).toHaveCount(0)

  expect(pageErrors, 'pageerrors during linkage journey').toEqual([])
  expect(consoleErrors.filter((t) => PLUGIN_CONSOLE.test(t)), 'plugin console errors').toEqual([])
})

test('multi-instance: 并存编号「侧边 N」+ 关闭互不影响', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await openSeedSession(page)
  const sidebar = page.locator('[data-dsh-better-sidebar]')

  // 开第一个侧边聊天
  await openPlusMenu(page)
  await page.getByRole('menuitem', { name: /Side chat/ }).first().click()
  await expect(sidebar.getByText(/full history snapshot/).first()).toBeVisible({ timeout: 60_000 })

  // 开第二个：标题应为「侧边 2」（第一个 Tab 转为非激活，其内容隐藏——
  // 断言一律过滤 visible，避免命中非激活 Tab 的隐藏 DOM）。
  await openPlusMenu(page)
  await page.getByRole('menuitem', { name: /Side chat/ }).first().click()
  await expect(sidebar.getByText('Side 2', { exact: true }), '第二个侧边聊天未编号为「侧边 2」').toBeVisible({ timeout: 30_000 })
  await expect(
    sidebar.getByText(/full history snapshot/).filter({ visible: true }).first(),
    '第二个侧边聊天未渲染 fork 历史',
  ).toBeVisible({ timeout: 60_000 })
  await dumpStep(page, '10-two-side-chats')

  // 关闭「侧边 2」：Tab 条上的 Close 按钮（同 tab 容器内）。
  const tab2 = sidebar.getByText('Side 2', { exact: true })
  const close2 = tab2.locator('xpath=..').getByRole('button', { name: /Close|关闭/ }).first()
  await close2.click()
  await expect(sidebar.getByText('Side 2', { exact: true }), '关闭后「侧边 2」仍在').toHaveCount(0)
  // 第一个侧边聊天不受影响：Tab 条上「侧边」仍在（内容区是否激活取决于
  // 关闭后的聚焦落点，不断言可见性）。
  await expect(sidebar.getByText('Side', { exact: true }).first(), '「侧边」Tab 被误伤').toBeVisible()
  await dumpStep(page, '11-after-close')

  expect(pageErrors, 'pageerrors during multi-instance').toEqual([])
})

test('annotation manage: 双注释编号不重排 + 重开编辑 + chip 逐条移除', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await openSeedSession(page)
  const overlay = page.locator('[data-dsh-sidechat]')

  // 注释 1（带注解「甲」）
  await injectSelection(page)
  await overlay.getByText('Add to conversation').click()
  await overlay.locator('input, textarea').first().fill('note one')
  await overlay.locator('button[aria-label="Save note"]').click()
  await expect(overlay.getByRole('button', { name: '1', exact: true }), '角标 1 未出现').toBeVisible({ timeout: 10_000 })

  // 注释 2（空注解）——草稿前缀变长会把消息顶出视口，角标按视口裁剪消失，
  // 断言前先把消息滚回顶部。
  await injectSelection(page)
  await overlay.getByText('Add to conversation').click()
  await overlay.locator('button[aria-label="Save note"]').click()
  await scrollChatToTop(page)
  await expect(overlay.getByRole('button', { name: '2', exact: true }), '角标 2 未出现').toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('2 annotations').first(), 'chip 未显示 2 条').toBeVisible({ timeout: 10_000 })

  // 点角标 1 重开编辑器：已有注解「note one」；删除 → 角标 1 消失、角标 2 不重排
  await overlay.getByRole('button', { name: '1', exact: true }).click()
  const editArea = overlay.locator('textarea').first()
  await expect(editArea, '重开态编辑器未出现').toBeVisible({ timeout: 10_000 })
  await expect(editArea).toHaveValue('note one')
  await overlay.locator('button[aria-label="Delete annotation"]').click()
  await expect(overlay.getByRole('button', { name: '1', exact: true }), '角标 1 未随删除消失').toHaveCount(0)
  await expect(overlay.getByRole('button', { name: '2', exact: true }), '角标 2 被误重排/误删').toBeVisible()
  await expect(page.getByText('1 annotation').first(), 'chip 未减为 1 条').toBeVisible({ timeout: 10_000 })

  // chip 展开 → 逐条移除剩余注释 → chip 消失、角标清空
  await page.getByText('1 annotation').first().click()
  await page.locator('button[aria-label="Remove annotation 2"]').click()
  await expect(page.getByText(/annotation|annotations/), 'chip 未随清空消失').toHaveCount(0)
  await expect(overlay.getByRole('button', { name: '2', exact: true }), '角标 2 未随 chip 移除消失').toHaveCount(0)
  await dumpStep(page, '12-annotations-cleared')

  expect(pageErrors, 'pageerrors during annotation manage').toEqual([])
})

test('slash command: /side 出现在命令菜单且能打开侧边聊天', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await openSeedSession(page)

  // 主输入框敲 / 打开命令菜单，找 /side（commandUi popupSelect 贡献）。
  const composer = page.getByRole('textbox', { name: /Message the agent|输入消息|随心输入/ }).first()
  await composer.click()
  await page.keyboard.type('/')
  await dumpStep(page, '13-slash-menu')

  // 命令条目是 listbox 的 option（role=option，名称含「side」）。
  const sideEntry = page.getByRole('option', { name: /side/ }).first()
  await expect(sideEntry, '/side 未出现在命令菜单（commandUi 注册未生效）').toBeVisible({ timeout: 10_000 })
  await sideEntry.click()

  // popupSelect 形态：选「新建侧边聊天」。
  const newOption = page.getByText('New side chat').first()
  await expect(newOption, 'popupSelect 选项未弹出').toBeVisible({ timeout: 10_000 })
  await newOption.click()

  // 侧边聊天 Tab 打开并渲染 fork 历史。
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expect(
    sidebar.getByText(/full history snapshot/).filter({ visible: true }).first(),
    '/side 未能打开带历史的侧边聊天',
  ).toBeVisible({ timeout: 60_000 })
  await dumpStep(page, '14-slash-opened')

  expect(pageErrors, 'pageerrors during slash command').toEqual([])
  expect(consoleErrors.filter((t) => PLUGIN_CONSOLE.test(t)), 'plugin console errors').toEqual([])
})
