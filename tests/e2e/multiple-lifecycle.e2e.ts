import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSeedSession, openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => { await page.screenshot({ path: info.outputPath('multiple-lifecycle.png') }) })
const mainOf = (page: Page) => page.locator('[data-conversation-session]').first()
const inputOf = (view: Locator) => view.locator('[data-composer-input]')
const tabOf = (page: Page, id: string) => page.getByRole('tab').filter({ has: page.locator(`[data-sidebar-right-tab="${id}"]`) })
const tabIdOf = (side: Locator) => side.locator('xpath=ancestor::*[@data-sidebar-right-tab][1]').getAttribute('data-sidebar-right-tab') as Promise<string>
const focusOption = /^(Focus|聚焦)/
const reopenOption = /^(Reopen|重开)/

async function sideMenu(page: Page) {
  await inputOf(mainOf(page)).fill('/side')
  await page.getByRole('option', { name: /^side /i }).click()
}
async function twoChats(page: Page) {
  await prepareSeedPage(page)
  const a = await openSideChat(page), tabA = await tabIdOf(sideChatOf(page))
  await sideMenu(page)
  await page.getByRole('option', { name: /^(New side chat|新建侧边聊天)/ }).click()
  await expect(sideChatOf(page)).not.toHaveAttribute('data-sidenote-chat-session', a)
  await expect(inputOf(sideChatOf(page))).toBeVisible()
  return { a, tabA, b: (await sideChatOf(page).getAttribute('data-sidenote-chat-session'))! }
}

for (const oldMetadata of [false, true]) test(`multiple lifecycle: refresh recognizes unvisited tabs (old metadata=${oldMetadata})`, async ({ page }) => {
  const { a, b, tabA } = await twoChats(page)
  if (oldMetadata) await page.evaluate(() => {
    // Reproduce trial records written before nativeAddress was preserved.
    for (const store of [sessionStorage, localStorage]) for (const key of Object.keys(store).filter(key => key.startsWith('dsh-sidenote:side-meta:v1:'))) {
      const { nativeAddress: _address, ...meta } = JSON.parse(store.getItem(key)!)
      store.setItem(key, JSON.stringify(meta))
    }
  })
  await page.reload()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', b)
  await sideMenu(page)
  await expect(page.getByRole('option', { name: focusOption })).toHaveCount(2)
  await expect(page.getByRole('option', { name: reopenOption })).toHaveCount(0)
  await page.getByRole('option', { name: focusOption }).first().click()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', a)
  expect(await tabIdOf(sideChatOf(page))).toBe(tabA)
})

test('multiple lifecycle: closing an unvisited restored tab releases its metadata', async ({ page }) => {
  const { a, b, tabA } = await twoChats(page)
  await page.reload()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', b)
  // No earlier pagehide entry: closing must record even a body never visited.
  await page.evaluate(parent => localStorage.removeItem('dsh-sidenote:closed-side:v1:' + parent), process.env.DSH_E2E_SEED_SESSION!)
  await tabOf(page, tabA).hover()
  await tabOf(page, tabA).getByRole('button', { name: /^(Close|关闭)$/ }).click()
  await expect(tabOf(page, tabA)).toHaveCount(0)
  await expect.poll(() => page.evaluate(id => Object.keys(sessionStorage).filter(key => key.startsWith('dsh-sidenote:side-meta:v1:')).map(key => JSON.parse(sessionStorage.getItem(key)!)).some(meta => meta.childId === id), a)).toBe(false)
  await sideMenu(page)
  await expect(page.getByRole('option', { name: focusOption })).toHaveCount(1)
  await page.getByRole('option', { name: reopenOption }).click()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', a)
})

test('multiple lifecycle: background save closes only its source and preserves foreground navigation', async ({ page }) => {
  await prepareSeedPage(page)
  await page.getByRole('button', { name: /^(New chat|New session|New conversation|新会话|新对话)$/ }).first().click()
  const main = mainOf(page)
  await expect(main).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  const parentB = (await main.getAttribute('data-conversation-session'))!
  await selectModel(page, main, 'Controlled E2E')
  await inputOf(main).fill('Create a completed turn for the second parent')
  await inputOf(main).press('Enter')
  await expect.poll(() => sessionEventsOf(parentB).findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  await expect(inputOf(sideChatOf(page))).toBeVisible()
  const childB = (await sideChatOf(page).getAttribute('data-sidenote-chat-session'))!
  const tabB = await tabIdOf(sideChatOf(page))
  const openB = () => page.locator(`[role="treeitem"][data-row-key="session:${parentB}"]`).click()
  await openSeedSession(page)
  await openSideChat(page)
  const tabA = await tabIdOf(sideChatOf(page))
  expect(tabA).toBe(tabB) // Same tab id, different owning sessions.
  let release: (() => void) | undefined
  await page.route(/\/api\/session\/fork$/, async route => {
    const response = await route.fetch()
    await new Promise<void>(resolve => { release = resolve })
    await route.fulfill({ response })
  })
  try {
    await sideChatOf(page).getByRole('button', { name: /^(Save as session|保存为正式会话)$/ }).click()
    await expect.poll(() => !!release).toBe(true)
    await openB()
    await expect(main).toHaveAttribute('data-conversation-session', parentB)
    release!()
    await expect(page.locator(`[data-sidebar-right-session="${process.env.DSH_E2E_SEED_SESSION!}"] [data-sidebar-right-tab="${tabA}"]`)).toHaveCount(0)
    await expect(main).toHaveAttribute('data-conversation-session', parentB)
    await expect(tabOf(page, tabB)).toBeVisible()
    await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', childB)
    await openSeedSession(page)
    await expect(tabOf(page, tabA)).toHaveCount(0)
  } finally { release?.() }
})

test('multiple lifecycle: Alt-S follows focus between split side composers and the main composer', async ({ page }) => {
  await prepareSeedPage(page)
  await openSideChat(page)
  await page.getByRole('button', { name: /^(Split.*|分栏)$/ }).click()
  await page.locator('[data-sidebar-right-guide-entry="dsh-sidenote:side"]').click()
  await expect(sideChatOf(page)).toHaveCount(2)
  const inputs = sideChatOf(page).locator('[data-composer-input]')
  await expect(inputs).toHaveCount(2)
  for (const input of await inputs.all()) {
    await input.click()
    await input.press('Alt+s')
    await expect(inputOf(mainOf(page))).toBeFocused()
    await inputOf(mainOf(page)).press('Alt+s')
    await expect(input).toBeFocused()
  }
})
