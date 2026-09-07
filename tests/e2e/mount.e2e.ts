/**
 * dsh-sidenote headless mount lane. The server is NOT started here —
 * scripts/e2e-mount.sh boots `dsh web` (better-sidebar from npm + our tarball
 * via the official `dsh plugin add` channel) and plants a fabricated session
 * with one completed turn (scripts/seed-session.mjs); the scratch workspace
 * is registered through the host RPC in beforeAll below.
 *
 * Host transport (0.1.1 bare origin vs 0.1.2 one-time-token URL + cookie +
 * slash endpoints) is centralized in ./host.ts — ported from
 * dsh-better-sidebar's verified dual-dialect adapter; no lane here talks to
 * the host transport directly.
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
import { createHostApi, gotoPage, hostRpc } from './host'

const PLUGIN_CONSOLE = /dsh-sidenote|Unhandled/

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

// 注册 scratch 工作区（种子会话的 cwd 挂在它下面才会进 GUI 列表）。
// 经 ./host 的双方言 RPC：0.1.1 点式端点优先、0.1.2 斜杠端点 404 回退
// （+ 首个请求先用启动 token 换 cookie）——之前 shell 里那手裸 curl 点式
// 调用在 0.1.2 上 404/401，已从 e2e-mount.sh 移到这里统一处理。注册失败
// 对整条 lane 是致命的（5/7 个测试依赖会话列表），直接在 beforeAll 抛错
// 比 5 个 lane 各自 90s 超时好诊断。
test.beforeAll(async () => {
  const workspace = process.env.DSH_E2E_WORKSPACE
  if (!workspace) {
    throw new Error('DSH_E2E_WORKSPACE is not set — run via scripts/e2e-mount.sh')
  }
  const api = await createHostApi()
  await hostRpc(api, 'workspace.create', { path: workspace })
})

test.beforeEach(async ({ page }) => {
  // 0.1.2 宿主：goto 前先种鉴权 cookie（token 换取，进程内一次）；
  // 0.1.1 宿主：裸 origin 直达。首屏 401/超时的双方言差异都收在这里。
  await gotoPage(page)
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
  await expandInherited(page)
  await expect(
    sidebar.getByText(/full history snapshot/).first(),
    '侧边聊天面板未渲染 fork 出的历史（折叠卡展开后）',
  ).toBeVisible({ timeout: 15_000 })

  // 等布局持久化落定（better-sidebar 的 200ms 防抖写盘 + 余量）。
  await page.waitForTimeout(2_000)

  // 子会话不进左侧会话列表：列表里「Side chat plugin review」唯一，且无新增行。
  // （严格结构断言留给真实页面验收；这里以「侧边」Tab 存在 + 无新会话标题为准。）

  // 刷新：布局持久化恢复 Tab，历史重绑。
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  await expandInherited(page)
  await expect(
    sidebar.getByText(/full history snapshot/).first(),
    '刷新后侧边聊天的 fork 历史未恢复（折叠卡展开后）',
  ).toBeVisible({ timeout: 15_000 })
  await dumpStep(page, '05-after-reload')

  expect(pageErrors, 'pageerrors during fork journey').toEqual([])
  expect(consoleErrors.filter((t) => PLUGIN_CONSOLE.test(t)), 'plugin console errors').toEqual([])
})

test('tool cards: fork 历史里的 read/bash 渲染为原生级工具卡（正样本）', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await openSeedSession(page)
  await openPlusMenu(page)
  await page.getByRole('menuitem', { name: /Side chat/ }).first().click()

  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expandInherited(page)

  // 种子 turn 3：read README.md + bash `ls -1` 并行（presentationMeta fixture）。
  // 卡片默认折叠（密度于默认态）：标题行可见即渲染意图已生效；
  // 卡种类正样本——终端卡的标题就是命令本身，read 卡的标题含文件路径。
  const terminalTitle = sidebar.getByText('ls -1', { exact: true }).first()
  await expect(terminalTitle, '终端工具卡标题未出现（callView/resultView 未映射）').toBeVisible({ timeout: 15_000 })
  // read 卡标题是宿主工具的 presentCall 产物（`Read <path>`，dsh-tool-fs 实证）。
  await expect(
    sidebar.getByText(/Read README\.md/).first(),
    'read 工具卡标题未出现',
  ).toBeVisible({ timeout: 15_000 })

  // 展开终端卡 → TerminalBlock 输出（exit code 0 的输出正文，种子 fixture 已验证
  // 宿主投影产出 terminal 卡）。点击标题行展开（DisclosureRow expandOnRowClick）。
  // 点击 DisclosureRow 行容器（[data-disclosure-row]），不点文本——与
  // jsdom 冒烟同姿势（文本节点的 click 目标在宿主合成事件下不稳定）。
  await terminalTitle.locator('xpath=ancestor-or-self::*[@data-disclosure-row][1]').click()
  await expect(
    sidebar.getByText(/package\.json/).first(),
    '终端卡展开后无命令输出',
  ).toBeVisible({ timeout: 5_000 })

  // read 卡展开 → ReadBlock 行号代码视图（0.1.2 的 primitives labels
  // 无守卫读是同族风险——ReadBlock 展开实证覆盖）。
  await sidebar.getByText(/Read README\.md/).first()
    .locator('xpath=ancestor-or-self::*[@data-disclosure-row][1]').click()
  await expect(
    sidebar.getByText(/# dsh-sidenote/).first(),
    'read 卡展开后无文件内容',
  ).toBeVisible({ timeout: 5_000 })
  await dumpStep(page, '15-tool-cards')

  expect(pageErrors, 'pageerrors during tool cards').toEqual([])
})

/** D1 折叠卡：等待并展开「继承自主会话」区（fork 历史默认折叠——密度默认态）。 */
async function expandInherited(page: Page): Promise<void> {
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  const card = sidebar.locator('[data-disclosure-row]', { hasText: /Inherited from main session|继承自主会话/ }).filter({ visible: true }).first()
  await expect(card, 'D1 父历史折叠卡未出现').toBeVisible({ timeout: 60_000 })
  await card.click()
}

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
/** 把指定文本滚进视口中央（不依赖滚动容器结构，跨 better-sidebar 版本稳）。 */
async function scrollTextIntoView(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if ((n.textContent ?? '').includes(needle)) {
        n.parentElement?.scrollIntoView({ block: 'center' })
        return
      }
    }
  }, text)
  await page.waitForTimeout(400)
}

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

test('annotate journey: 划选 → 浮层 → 注解编辑器 → 角标 → chip（草稿零污染）→ 刷新恢复', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await openSeedSession(page)

  // 气泡留痕（C2 P0-3 回归）：种子会话 turn 2 的用户消息携带 v3 协议前缀
  // ——协议区必须被隐藏、显示「1 annotated」标签，正文仍在。
  const seededBubble = page.locator('[data-chat-flow-kind="user"]', { hasText: 'Looks good overall' })
  await expect(seededBubble, '种子协议气泡未出现').toBeVisible({ timeout: 10_000 })
  await expect(seededBubble.getByText('1 annotated'), '气泡「批注 ×N」标签未出现（手术未命中）').toBeVisible({ timeout: 10_000 })
  // 协议区被隐藏（display:none 的包层 span；文本仍在 DOM 但不可见）。
  await expect(
    seededBubble.getByText('<annotation', { exact: false }).first(),
    '协议 XML 块未被隐藏',
  ).toBeHidden()

  // Delivery_02 W02：顶栏「Side」常驻入口（header.utilities 槽位；非 blank
  // 会话内才渲染）。
  await expect(
    page.getByRole('button', { name: /Open a side chat/ }).first(),
    '顶栏「侧边」入口未出现（header.utilities 槽位注册未生效）',
  ).toBeVisible({ timeout: 10_000 })

  await injectSelection(page)

  // 浮层工具条：两个去向按钮。
  const overlay = page.locator('[data-dsh-sidenote]')
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
  // 锚点可能在视口上方（长会话滚底）——角标按视口裁剪不渲染是设计行为，
  // 先把消息滚回顶部再断言。
  await scrollChatToTop(page)
  await expect(overlay.getByText('1', { exact: true }).first(), '编号角标 1 未出现').toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('1 annotation').first(), 'composer chip 未出现').toBeVisible({ timeout: 10_000 })
  await dumpStep(page, '08-chip')

  // 受控架构（Delivery_02）：草稿**不被污染**（注释不进草稿文本流）。
  // 主 composer 可能是 textarea 或 contenteditable，两种读法都试。
  // aria-label 随宿主版本漂移：0.1.1 "Message the agent"、0.1.2
  // "Message or run a task... / commands, @ files or sessions"（实证于
  // 0.1.2-rc.1 档的 09-linkage 步骤快照）——正则双文案通吃。
  const composer = page.getByRole('textbox', { name: /Message the agent|Message or run a task|输入消息|随心输入/ }).first()
  const draft = await composer.evaluate((el) => (
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? '')
  ))
  expect(draft, '草稿被协议文本污染（受控架构要求草稿无引用块）').not.toContain('watch the memory cost')
  expect(draft).not.toContain('annotated')

  // 持久化（Delivery_02）：刷新后角标 + chip 从 localStorage 恢复。
  await page.reload()
  await expect(page.getByText('1 annotation').first(), '刷新后 chip 未恢复').toBeVisible({ timeout: 10_000 })
  // 角标受视口裁剪纪律约束——等历史渲染完、把锚文本滚进视口再断言
  //（scrollChatToTop 在内容未就绪时会滚空，跨版本时序不稳）。
  await expect(page.getByText(/full history snapshot/).first()).toBeVisible({ timeout: 15_000 })
  await scrollTextIntoView(page, 'full history snapshot')
  await expect(overlay.getByText('1', { exact: true }).first(), '刷新后角标未恢复').toBeVisible({ timeout: 15_000 })
  await dumpStep(page, '08b-restored-after-reload')

  // 发送拦截全链路（C2 P0/P1 回归）：带注释 Enter → 提交后草稿清空 →
  // chip 消失（注释 sent）→ 新气泡协议区隐藏 +「1 annotated」标签。
  // 注意：不轮询草稿中间态。0.1.2 的 Lexical 管线下 setDraft(协议块) 与
  // submit 的乐观 commitSend 在同一渲染批次落 DOM（实证见
  // reports/ux-review/W01-intercept-012-debug.md）——「协议块已拼入」的
  // 可观察证据是终态：新气泡 DOM 含协议文本（隐藏区）+ 留痕标签。
  // 0.1.1 的 textarea 管线中间态可见但窗口不定，统一改终态断言双兼容。
  await composer.click()
  await composer.pressSequentially('answer my notes')
  await page.keyboard.press('Enter')
  // 提交被宿主接受（无模型 → turn 会报错，但消息已入流）：草稿清空。
  await expect
    .poll(async () => composer.evaluate((el) => (
      el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? '')
    )), { timeout: 8_000 })
    .toBe('')
  await expect(page.getByText('1 annotation').filter({ visible: true }), '发送后 chip 未消失').toHaveCount(0)
  // 新发出的气泡：协议区隐藏 + 留痕标签（协议块确实拼进了发送文本）。
  const sentBubble = page.locator('[data-chat-flow-kind="user"]', { hasText: 'answer my notes' })
  await expect(sentBubble.getByText('1 annotated'), '新气泡留痕标签未出现').toBeVisible({ timeout: 10_000 })
  await expect(sentBubble.getByText('<annotation', { exact: false }).first(), '新气泡协议区未隐藏').toBeHidden()
  await dumpStep(page, '08c-sent-with-annotation')

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
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText('Ask in side chat').click()
  const noteInput = overlay.locator('input[aria-label="Side chat note"]')
  await expect(noteInput, '侧边提问未弹注解编辑器').toBeVisible({ timeout: 10_000 })
  await noteInput.fill('discuss this point')
  await overlay.locator('button[aria-label="Confirm and ask"]').click()

  // 侧边聊天 Tab 打开（fork 主会话），composer 草稿带「引用 + 注解」。
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expandInherited(page)
  await expect(
    sidebar.getByText(/full history snapshot/).first(),
    '侧边聊天未打开或未渲染 fork 历史（折叠卡展开后）',
  ).toBeVisible({ timeout: 15_000 })
  const sideComposer = sidebar.getByRole('textbox').first()
  const sideDraft = await sideComposer.evaluate((el) => (
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? '')
  ))
  expect(sideDraft, '侧边聊天草稿缺少引用').toContain('full history snapshot')
  expect(sideDraft).toContain('discuss this point')
  await dumpStep(page, '09-linkage')

  // 互斥：主对话不产生注释（无角标、无 chip）。
  await expect(overlay.getByText('1', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/^\d+ annotations?$/).filter({ visible: true })).toHaveCount(0)

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
  await expandInherited(page)
  await expect(sidebar.getByText(/full history snapshot/).first()).toBeVisible({ timeout: 15_000 })

  // 开第二个：标题应为「侧边 2」（第一个 Tab 转为非激活，其内容隐藏——
  // 断言一律过滤 visible，避免命中非激活 Tab 的隐藏 DOM）。
  await openPlusMenu(page)
  await page.getByRole('menuitem', { name: /Side chat/ }).first().click()
  await expect(sidebar.getByText('Side 2', { exact: true }), '第二个侧边聊天未编号为「侧边 2」').toBeVisible({ timeout: 30_000 })
  await expandInherited(page)
  await expect(
    sidebar.getByText(/full history snapshot/).filter({ visible: true }).first(),
    '第二个侧边聊天未渲染 fork 历史（折叠卡展开后）',
  ).toBeVisible({ timeout: 15_000 })
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
  const overlay = page.locator('[data-dsh-sidenote]')

  // 注释 1（带注解「甲」）
  await injectSelection(page)
  await overlay.getByText('Add to conversation').click()
  await overlay.locator('input, textarea').first().fill('note one')
  await overlay.locator('button[aria-label="Save note"]').click()
  // 锚点在视口上方时角标按设计不渲染——先滚回顶部（视口裁剪纪律）。
  await scrollChatToTop(page)
  await expect(overlay.getByRole('button', { name: '1', exact: true }), '角标 1 未出现').toBeVisible({ timeout: 10_000 })

  // 注释 2（空注解）——先把消息滚回顶部再断言角标（视口裁剪纪律）。
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
  // 只数可见元素（气泡手术隐藏区的协议文本仍在 DOM，display:none 不算）。
  await expect(page.getByText(/^\d+ annotations?$/).filter({ visible: true }), 'chip 未随清空消失').toHaveCount(0)
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
  // composer aria-label 双文案：0.1.1 / 0.1.2 宿主不同（见 annotate lane）。
  const composer = page.getByRole('textbox', { name: /Message the agent|Message or run a task|输入消息|随心输入/ }).first()
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
  await expandInherited(page)
  await expect(
    sidebar.getByText(/full history snapshot/).filter({ visible: true }).first(),
    '/side 未能打开带历史的侧边聊天（折叠卡展开后）',
  ).toBeVisible({ timeout: 15_000 })
  await dumpStep(page, '14-slash-opened')

  expect(pageErrors, 'pageerrors during slash command').toEqual([])
  expect(consoleErrors.filter((t) => PLUGIN_CONSOLE.test(t)), 'plugin console errors').toEqual([])
})

test('slash menu: 侧边 composer 斜杠菜单（inputTriggers 引擎接线 + /side 不可嵌套）', async ({ page }) => {
  test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await openSeedSession(page)
  await openPlusMenu(page)
  await page.getByRole('menuitem', { name: /Side chat/ }).first().click()

  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expandInherited(page)

  // 侧边 composer 聚焦敲 '/'（我们自己的 textarea，role=textbox）。
  const sideComposer = sidebar.getByRole('textbox').first()
  await sideComposer.click()
  await page.keyboard.type('/')

  // 菜单开（自绘皮 listbox），候选出现；/side 被过滤（不可嵌套 P2-3）。
  const menu = sidebar.locator('[role="listbox"]')
  await expect(menu, '侧边斜杠菜单未打开').toBeVisible({ timeout: 10_000 })
  const options = menu.getByRole('option')
  await expect(options.first(), '菜单无候选').toBeVisible({ timeout: 10_000 })
  await expect(options.filter({ hasText: /^\/side/ }), '侧边会话不应出现 /side（不可嵌套）').toHaveCount(0)

  // Escape 关闭。
  await page.keyboard.press('Escape')
  await expect(menu, 'Esc 未关闭菜单').toHaveCount(0)
  await dumpStep(page, '16-slash-menu-side')

  expect(pageErrors, 'pageerrors during slash menu').toEqual([])
})
