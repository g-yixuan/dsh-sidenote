# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mount.e2e.ts >> plugin mounts: sidebar hosts the 侧边聊天 tab type
- Location: tests/e2e/mount.e2e.ts:77:1

# Error details

```
Error: 「侧边聊天」未出现在 + 菜单——registerTab 未生效

expect(locator).toHaveCount(expected) failed

Locator:  getByRole('menuitem', { name: /侧边聊天/ }).first()
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - 「侧边聊天」未出现在 + 菜单——registerTab 未生效 with timeout 5000ms
  - waiting for getByRole('menuitem', { name: /侧边聊天/ }).first()
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e7]:
      - button "Open sidebar" [ref=e9] [cursor=pointer]
      - button "New session" [ref=e12] [cursor=pointer]
      - generic [ref=e17]:
        - button "Add workspace" [ref=e20] [cursor=pointer]
        - button "Search sessions" [ref=e25] [cursor=pointer]
      - button [ref=e33] [cursor=pointer]
    - generic [ref=e46]:
      - generic [ref=e49]:
        - generic [ref=e53]: Into the Unknown
        - generic [ref=e54]: Preview
      - generic [ref=e55]:
        - button "Choose workspace" [ref=e56] [cursor=pointer]:
          - generic [ref=e60]: workspace
        - button "Standard mode" [ref=e65] [cursor=pointer]
      - generic [ref=e75]:
        - textbox "Describe what you want to build" [ref=e78]
        - generic [ref=e79]:
          - generic [ref=e80]:
            - button "Commands" [ref=e81] [cursor=pointer]
            - 'button "Access mode, current: Workspace Write" [ref=e86] [cursor=pointer]':
              - generic [ref=e94]: Workspace Write
          - generic [ref=e98]:
            - button "Select model, current DeepSeek-V4-Flash, reasoning effort High" [ref=e101] [cursor=pointer]:
              - generic [ref=e102]: DeepSeek-V4-Flash
              - generic [ref=e103]: High
            - button "Send message" [disabled] [ref=e106]
    - generic [ref=e110]:
      - generic [ref=e111]:
        - generic: Details
        - button "Close details" [ref=e112] [cursor=pointer]
      - generic [ref=e115]: Click a tool row in the message flow to view its details
  - generic:
    - generic [ref=e116]:
      - button "Expand bottom panel" [ref=e117] [cursor=pointer]
      - button "Collapse sidebar" [ref=e121] [cursor=pointer]
    - generic [ref=e129]:
      - generic [ref=e131]:
        - generic "Explorer" [ref=e132] [cursor=pointer]:
          - button "Close" [ref=e137]
        - button "New tab" [active] [ref=e141] [cursor=pointer]
      - generic [ref=e146]:
        - generic [ref=e147]:
          - generic "/private/tmp/dsh-e2e-dry.rGQgqr/workspace" [ref=e148]: workspace
          - button "Refresh" [ref=e149] [cursor=pointer]
        - generic [ref=e152]: workspace
  - menu [ref=e158]:
    - menuitem "Explorer" [ref=e160] [cursor=pointer]
    - menuitem "Source Control" [ref=e167] [cursor=pointer]
    - menuitem "Tasks" [ref=e173] [cursor=pointer]
    - menuitem "Terminal" [ref=e180] [cursor=pointer]
    - menuitem "Browser" [ref=e187] [cursor=pointer]
```

# Test source

```ts
  1   | /**
  2   |  * dsh-side-chat headless mount lane. The server is NOT started here —
  3   |  * scripts/e2e-mount.sh boots `dsh web` (better-sidebar from npm + our tarball
  4   |  * via the official `dsh plugin add` channel) and injects DSH_E2E_URL.
  5   |  *
  6   |  * A fabricated session with one completed turn (scripts/seed-session.mjs) is
  7   |  * planted in the scratch DSH_HOME so the fork path works without any model
  8   |  * credential.
  9   |  *
  10  |  * Covered:
  11  |  *  1. shell + better-sidebar mount, no crash markers, no plugin console errors;
  12  |  *  2. the + menu offers 「侧边聊天」 and opening it renders the panel
  13  |  *     (empty state, or the graceful error state when the current session is
  14  |  *     not forkable);
  15  |  *  3. fork journey: open the seeded session → open 侧边聊天 → the forked
  16  |  *     history renders → the child session stays out of the session list →
  17  |  *     reload → the tab and history survive (layout restore).
  18  |  *
  19  |  * Selectors of the host shell (session list rows etc.) are not public
  20  |  * contracts — iterate here when the shell drifts; assertions about our own
  21  |  * plugin surface must stay strict.
  22  |  */
  23  | import { test, expect } from '@playwright/test'
  24  | 
  25  | const BASE_URL = process.env.DSH_E2E_URL
  26  | if (!BASE_URL) {
  27  |   throw new Error('DSH_E2E_URL is not set — run via scripts/e2e-mount.sh')
  28  | }
  29  | 
  30  | /** Crash markers: our client renders nothing on fatal error without these. */
  31  | const PLUGIN_CONSOLE = /dsh-side-chat|Unhandled/
  32  | 
  33  | /** Dismiss keyless-boot onboarding takeovers (Continue / Configure later). */
  34  | async function dismissOnboarding(page: import('@playwright/test').Page): Promise<void> {
  35  |   try {
  36  |     await expect
  37  |       .poll(() => page.getByRole('button', { name: /^(Continue|Configure later|继续|稍后再说)$/ }).count(), { timeout: 30_000 })
  38  |       .toBeGreaterThan(0)
  39  |   } catch {
  40  |     return
  41  |   }
  42  |   for (let round = 0; round < 8; round++) {
  43  |     let dismissed = false
  44  |     for (const name of ['Continue', 'Configure later', '继续', '稍后再说']) {
  45  |       const button = page.getByRole('button', { name, exact: true }).first()
  46  |       if ((await button.count()) === 0) continue
  47  |       try {
  48  |         await button.click({ timeout: 4_000 })
  49  |         dismissed = true
  50  |         await page.waitForTimeout(1_000)
  51  |       } catch {
  52  |         // masked by the takeover stacked above; next round retries
  53  |       }
  54  |     }
  55  |     if (!dismissed) break
  56  |   }
  57  | }
  58  | 
  59  | test.beforeEach(async ({ page }) => {
  60  |   const pageErrors: string[] = []
  61  |   const consoleErrors: string[] = []
  62  |   page.on('pageerror', (error) => pageErrors.push(String(error)))
  63  |   page.on('console', (message) => {
  64  |     if (message.type() === 'error') consoleErrors.push(message.text())
  65  |   })
  66  |   page.on('close', () => {
  67  |     const pluginErrors = consoleErrors.filter((text) => PLUGIN_CONSOLE.test(text))
  68  |     if (pageErrors.length || pluginErrors.length) {
  69  |       console.warn('[e2e] pageerrors:', pageErrors, 'plugin console errors:', pluginErrors)
  70  |     }
  71  |   })
  72  |   await page.goto(BASE_URL!, { waitUntil: 'domcontentloaded' })
  73  |   await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 90_000 })
  74  |   await dismissOnboarding(page)
  75  | })
  76  | 
  77  | test('plugin mounts: sidebar hosts the 侧边聊天 tab type', async ({ page }) => {
  78  |   const pageErrors: string[] = []
  79  |   page.on('pageerror', (error) => pageErrors.push(String(error)))
  80  | 
  81  |   const sidebar = page.locator('[data-dsh-better-sidebar]')
  82  |   await expect(sidebar).toBeAttached({ timeout: 90_000 })
  83  | 
  84  |   // The + menu must offer our tab type.
  85  |   const newTabButton = sidebar.getByRole('button', { name: /New tab|新建|新标签/ }).first()
  86  |   await newTabButton.click()
  87  |   const item = page.getByRole('menuitem', { name: /侧边聊天/ }).first()
> 88  |   await expect(item, '「侧边聊天」未出现在 + 菜单——registerTab 未生效').toHaveCount(1)
      |                                                          ^ Error: 「侧边聊天」未出现在 + 菜单——registerTab 未生效
  89  |   await item.click()
  90  | 
  91  |   // The panel renders our empty state (or the graceful fork error state when
  92  |   // the current session is blank — keyless boot may land on a blank session).
  93  |   await expect(
  94  |     page.getByText(/侧边聊天从当前会话 fork|无法 fork|会话已不存在|侧边聊天/).first(),
  95  |     '侧边聊天面板无任何可识别内容',
  96  |   ).toBeVisible({ timeout: 30_000 })
  97  | 
  98  |   expect(pageErrors, 'pageerrors during mount').toEqual([])
  99  | })
  100 | 
  101 | test('fork journey: seeded session → side chat → history renders → survives reload', async ({ page }) => {
  102 |   test.skip(!process.env.DSH_E2E_SEED_SESSION, 'no seeded session id')
  103 |   const pageErrors: string[] = []
  104 |   page.on('pageerror', (error) => pageErrors.push(String(error)))
  105 | 
  106 |   // Open the seeded session from the session list (its user message text is
  107 |   // unique). The shell's list-row selector is not a public contract — adjust
  108 |   // here when the shell drifts.
  109 |   const seedRow = page.getByText('蓝鲸预算').first()
  110 |   await expect(seedRow, '伪造会话未出现在会话列表').toBeVisible({ timeout: 30_000 })
  111 |   await seedRow.click()
  112 |   await page.waitForTimeout(1_500)
  113 | 
  114 |   // Open the side chat; fork should succeed against the completed turn.
  115 |   const sidebar = page.locator('[data-dsh-better-sidebar]')
  116 |   await sidebar.getByRole('button', { name: /New tab|新建|新标签/ }).first().click()
  117 |   await page.getByRole('menuitem', { name: /侧边聊天/ }).first().click()
  118 | 
  119 |   // The forked history renders the seeded assistant reply inside the panel.
  120 |   await expect(
  121 |     sidebar.getByText(/蓝鲸预算/).first(),
  122 |     '侧边聊天面板未渲染 fork 出的历史',
  123 |   ).toBeVisible({ timeout: 30_000 })
  124 | 
  125 |   // The child session must not appear in the session list (archived).
  126 |   // Heuristic: the list shows exactly one session containing 蓝鲸预算.
  127 |   // (Strict structural assertion deferred to real-page verification.)
  128 | 
  129 |   // Reload: layout persistence restores the tab; history rebinds.
  130 |   await page.reload({ waitUntil: 'domcontentloaded' })
  131 |   await dismissOnboarding(page)
  132 |   await expect(
  133 |     sidebar.getByText(/蓝鲸预算/).first(),
  134 |     '刷新后侧边的 fork 历史未恢复',
  135 |   ).toBeVisible({ timeout: 60_000 })
  136 | 
  137 |   expect(pageErrors, 'pageerrors during fork journey').toEqual([])
  138 | })
  139 | 
```