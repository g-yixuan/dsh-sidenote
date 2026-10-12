import { test, expect, type Page } from '@playwright/test'
import { createHostApi, gotoPage, hostRpc } from './host'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

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

const OVERLAY = '[data-dsh-sidenote]'
const STORAGE_KEY = `dsh-sidenote:annotations:v1:${process.env.DSH_E2E_SEED_SESSION}`
const composerOf = (page: Page) => page.locator('[data-composer-seat] [data-composer-input], [data-composer-seat] textarea').first()
const chipOf = (page: Page) => page.getByText(/^(\d+ annotations?|\d+ 条注释)$/).first()

async function items(page: Page): Promise<Array<{ id: number; number: number; note: string; state: string }>> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), STORAGE_KEY)
}

async function selectQuote(page: Page): Promise<void> {
  const quote = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()
  await quote.scrollIntoViewIfNeeded()
  const selected = await quote.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const needle = 'full history snapshot'
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(needle)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return true
    }
    return false
  })
  expect(selected).toBe(true)
}

async function addQuote(page: Page): Promise<void> {
  await selectQuote(page)
  await page.locator(OVERLAY).getByText(/^(Add to conversation|添加到对话)$/).click()
  await expect(page.locator(`${OVERLAY} input`)).toBeVisible()
}

test.describe('annotation editor lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPage(page)
    await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 30_000 })
    await dismissOnboarding(page)
    const open = page.getByRole('button', { name: /^(Open sidebar|打开侧栏)$/ }).first()
    if (await open.isVisible()) await open.click()
    // Native hosts can keep forked children in the list with the parent's title.
    // Select the seeded identity so a preceding side-chat test cannot redirect us.
    const seedRow = page.locator(`[role="treeitem"][data-row-key="session:${process.env.DSH_E2E_SEED_SESSION}"]`)
    const row = await seedRow.count() > 0 ? seedRow : page.getByRole('treeitem').filter({ hasText: 'Side chat plugin review' }).first()
    const title = (await row.count()) > 0 ? row.getByText('Side chat plugin review', { exact: true }).first() : page.getByText('Side chat plugin review').first()
    await title.click()
    const conversation = page.locator('[data-conversation-session]').first()
    if (await conversation.count() > 0) {
      await expect(conversation).toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
    }
    await expect(page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first()).toBeAttached({ timeout: 30_000 })
  })

  test('side-chat note survives outside click; empty note saves and Escape discards', async ({ page }) => {
    const overlay = page.locator(OVERLAY)
    const ask = async () => {
      await selectQuote(page)
      await overlay.getByText(/^(Ask in side chat|在侧边聊天中提问)$/).click()
      await expect(overlay.locator('input')).toBeVisible()
    }
    await ask()
    await overlay.locator('input').fill('侧边外点保存的完整注解')
    await composerOf(page).click()
    await expect(overlay.locator('input')).toHaveCount(0)
    const sideInput = page.getByPlaceholder(/^(Message…|输入消息)/).first()
    await expect(sideInput).toHaveValue(/full history snapshot[\s\S]*侧边外点保存的完整注解/, { timeout: 30_000 })
    expect(await items(page)).toEqual([])

    await ask()
    await composerOf(page).click()
    await expect(sideInput).toHaveValue(/(?:\(no note\)|（无注解）)/)
    const beforeCancel = await sideInput.inputValue()
    expect(beforeCancel.match(/full history snapshot/g)).toHaveLength(2)
    await ask()
    await overlay.locator('input').fill('Escape 要放弃的注解')
    await page.keyboard.press('Escape')
    await expect(overlay.locator('input')).toHaveCount(0)
    await expect(sideInput).toHaveValue(beforeCancel)
    const evidence = process.env.DSH_E2E_EVIDENCE_DIR ?? 'test-results'
    mkdirSync(evidence, { recursive: true })
    await page.screenshot({ path: join(evidence, 'side-note-outside-saved.png') })
  })

  test('empty note survives composer click and reload', async ({ page }) => {
    await addQuote(page)
    await composerOf(page).click()
    await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
    await expect(chipOf(page)).toBeVisible()
    expect(await items(page)).toMatchObject([{ note: '', state: 'active' }])
    await page.reload()
    await expect(chipOf(page)).toBeVisible()
    expect(await items(page)).toMatchObject([{ note: '', state: 'active' }])
    await page.screenshot({ path: 'test-results/annotation-empty-saved.png' })
  })

  test('typed note survives composer click, reload and Enter submission', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('刚输入的中文注解')
    const composer = composerOf(page)
    await composer.click()
    await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
    expect(await items(page)).toMatchObject([{ note: '刚输入的中文注解', state: 'active' }])
    await expect(chipOf(page)).toBeVisible()
    await expect(composer).not.toContainText('刚输入的中文注解')
    await page.reload()
    await expect(chipOf(page)).toBeVisible()
    expect(await items(page)).toMatchObject([{ note: '刚输入的中文注解' }])
    await composer.click()
    await composer.pressSequentially('review annotation note')
    await composer.press('Enter')
    const bubble = page.locator('[data-chat-flow-kind="user"]').filter({ hasText: 'review annotation note' }).last()
    await expect(bubble).toContainText('<note>刚输入的中文注解</note>', { timeout: 10_000 })
    await expect.poll(() => items(page)).toMatchObject([{ note: '刚输入的中文注解', state: 'sent' }])
    await expect(chipOf(page)).toHaveCount(0)
    await page.screenshot({ path: 'test-results/annotation-sent.png' })
  })

  test('Escape explicitly discards a new annotation', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('要放弃的注解')
    await page.keyboard.press('Escape')
    await expect(page.locator(`${OVERLAY} input`)).toHaveCount(0)
    await expect(chipOf(page)).toHaveCount(0)
    expect(await items(page)).toEqual([])
  })

  test('clicking inside keeps editor open; outside edit preserves saved note', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).click()
    await expect(page.locator(`${OVERLAY} input`)).toBeVisible()
    await page.locator(`${OVERLAY} input`).fill('已保存注解')
    await page.locator(OVERLAY).getByRole('button', { name: /^(Save note|确认注解)$/ }).click()
    await page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'full history snapshot' }).first().scrollIntoViewIfNeeded()
    await page.locator(OVERLAY).getByRole('button', { name: '1', exact: true }).click()
    const editor = page.locator(`${OVERLAY} textarea`)
    await expect(editor).toHaveValue('已保存注解')
    await editor.fill('不应保存的修改')
    await composerOf(page).click()
    await expect(editor).toHaveCount(0)
    expect(await items(page)).toMatchObject([{ note: '已保存注解' }])
  })

  test('switching from new annotation to an existing badge must not save into the previous annotation', async ({ page }) => {
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('第一条原始注解')
    await page.locator(OVERLAY).getByRole('button', { name: /^(Save note|确认注解)$/ }).click()
    await addQuote(page)
    await page.locator(`${OVERLAY} input`).fill('第二条新建草稿')
    await page.locator(OVERLAY).getByRole('button', { name: '1', exact: true }).click()
    const editor = page.locator(`${OVERLAY} textarea`)
    await expect(editor).toHaveValue('第一条原始注解')
    await editor.fill('当前编辑第一条，应被取消')
    await page.screenshot({ path: 'test-results/annotation-switched-editor.png' })
    await composerOf(page).click()
    await expect(editor).toHaveCount(0)
    const saved = await items(page)
    await page.screenshot({ path: 'test-results/annotation-switch-after-outside.png' })
    expect(saved.find(item => item.number === 1)?.note).toBe('第一条原始注解')
    expect(saved.find(item => item.number === 2)?.note).toBe('')
  })
})
