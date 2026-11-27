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
  await page.getByRole('button', { name: /^(New side chat|新建侧边聊天)/ }).click()
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
  await expect(page.getByRole('button', { name: focusOption })).toHaveCount(2)
  await expect(page.getByRole('button', { name: reopenOption })).toHaveCount(0)
  await page.getByRole('button', { name: focusOption }).first().click()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', a)
  expect(await tabIdOf(sideChatOf(page))).toBe(tabA)
})

test('multiple lifecycle: closing an unvisited restored tab releases its metadata', async ({ page }) => {
  const { a, b, tabA } = await twoChats(page)
  await page.reload()
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', b)
  // No earlier pagehide entry: closing must record even a body never visited.
  await page.evaluate(parent => {
    for (const store of [localStorage, sessionStorage]) for (const key of Object.keys(store)) {
      if (key === 'dsh-sidenote:closed-side:v1:' + parent || key.startsWith('dsh-sidenote:closed-side:v2:' + encodeURIComponent(parent) + ':')) store.removeItem(key)
    }
  }, process.env.DSH_E2E_SEED_SESSION!)
  await tabOf(page, tabA).hover()
  await tabOf(page, tabA).getByRole('button', { name: /^(Close|关闭)$/ }).click()
  await expect(tabOf(page, tabA)).toHaveCount(0)
  await expect.poll(() => page.evaluate(id => Object.keys(sessionStorage).filter(key => key.startsWith('dsh-sidenote:side-meta:v1:')).map(key => JSON.parse(sessionStorage.getItem(key)!)).some(meta => meta.childId === id), a)).toBe(false)
  await sideMenu(page)
  await expect(page.getByRole('button', { name: focusOption })).toHaveCount(1)
  await page.getByRole('button', { name: reopenOption }).click()
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

test('side history: retains more than five, searches, confirms removal and reopens the original child', async ({ page }) => {
  await prepareSeedPage(page)
  const children: string[] = []
  const names = ['History algebra', 'History biology', 'History chemistry', 'History design', 'History engine', 'History frames', 'History graph', 'History horizon', 'History interval', 'History junction']
  for (const topic of names) {
    const child = await openSideChat(page)
    children.push(child)
    const side = sideChatOf(page)
    await selectModel(page, side, 'Controlled E2E')
    const turns = sessionEventsOf(child).filter(event => event.type === 'turn/end').length
    await inputOf(side).fill(topic)
    await inputOf(side).press('Enter')
    await expect.poll(() => sessionEventsOf(child).filter(event => event.type === 'turn/end').length).toBe(turns + 1)
    const tabId = await tabIdOf(side)
    await tabOf(page, tabId).hover()
    await tabOf(page, tabId).getByRole('button', { name: /^(Close|关闭)$/ }).click()
    await expect(tabOf(page, tabId)).toHaveCount(0)
  }
  await sideMenu(page)
  const menu = page.getByRole('dialog', { name: /^(Side chats|侧边聊天)$/ })
  const search = menu.getByRole('textbox', { name: /Search side chats|搜索侧聊/ })
  const row = (topic: string) => menu.locator('[data-sidenote-side-menu-row]').filter({ has: page.getByRole('button', { name: new RegExp(`^(Reopen|重开).*${topic}`) }) })
  const remove = (topic: string) => menu.getByRole('button', { name: new RegExp(`^(Remove|从历史中移除).*${topic}`) })
  const history = menu.getByRole('button', { name: reopenOption })
  await expect(history).toHaveCount(names.length)
  await expect(history.first()).toContainText(names.at(-1)!)
  await expect(search).toBeFocused()
  // Match the original host picker: the secondary time stays on the same row.
  const [titleBox, timeBox] = await Promise.all((await history.first().locator('span').all()).map(element => element.boundingBox()))
  expect(Math.abs((titleBox!.y + titleBox!.height / 2) - (timeBox!.y + timeBox!.height / 2))).toBeLessThan(5)
  const composerBox = await mainOf(page).locator('[data-composer-card]').boundingBox()
  expect(Math.abs((await menu.boundingBox())!.width - composerBox!.width)).toBeLessThan(12)
  await page.screenshot({ path: test.info().outputPath('history-menu.png') })
  await menu.getByRole('button', { name: /^(New side chat|新建侧边聊天)/ }).hover()
  await search.hover()
  await search.press('ArrowUp')
  await expect(history.last()).toBeInViewport()
  await remove('History algebra').focus()
  await remove('History algebra').press('Enter')
  const cancel = menu.getByRole('button', { name: /^(Cancel|取消)$/ })
  await expect(cancel).toBeFocused()
  await expect(cancel).toBeInViewport()
  await cancel.press('Escape')
  await expect(search).toBeFocused()
  await search.fill('History chemistry')
  await expect(history).toHaveCount(1)
  await search.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })))
  await expect(menu).toBeVisible()
  await search.hover()
  await expect(remove('History chemistry')).toHaveCSS('opacity', '0')
  await row('History chemistry').hover()
  await expect(remove('History chemistry')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: test.info().outputPath('history-hover.png') })
  await remove('History chemistry').click()
  await expect(menu.getByText(/conversation remains in DSH|原会话仍保存在 DSH/)).toBeVisible()
  await expect(menu.getByRole('button', { name: /^(Cancel|取消)$/ })).toBeFocused()
  await page.screenshot({ path: test.info().outputPath('history-confirm.png') })
  await menu.getByRole('button', { name: /^(Cancel|取消)$/ }).click()
  await expect(history).toHaveCount(1)
  await row('History chemistry').hover()
  await remove('History chemistry').click()
  await menu.getByRole('button', { name: /^(Remove|移除)$/ }).click()
  await expect(menu).toBeVisible()
  await expect(search).toHaveValue('History chemistry')
  await expect(history).toHaveCount(0)
  expect(JSON.stringify(sessionEventsOf(children[2]!))).toContain('History chemistry')
  await search.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(inputOf(mainOf(page))).toBeFocused()
  await page.reload()
  await expect(inputOf(mainOf(page))).toBeVisible()
  await inputOf(mainOf(page)).fill('/side')
  await inputOf(mainOf(page)).press('Enter')
  await expect(history).toHaveCount(names.length - 1)
  await search.fill('History algebra')
  await expect(history).toHaveCount(1)
  await search.press('Enter')
  await expect(sideChatOf(page)).toHaveAttribute('data-sidenote-chat-session', children[0]!)
  await expect(inputOf(sideChatOf(page))).toBeVisible()
})
