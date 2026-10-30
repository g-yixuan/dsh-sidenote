import { expect, test, type Locator } from '@playwright/test'
import { restartHost } from './host'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => { await page.screenshot({ path: info.outputPath('recovery.png') }) })
const stop = /^(Stop generating|停止生成)$/
const reflow = /^(Bring back to main conversation|带回主对话)$/
const toggleOf = (view: Locator) => view.locator('[data-sidenote-main-context] > button')

async function send(view: Locator, id: string, text: string) {
  const before = sessionEventsOf(id).filter(event => event.type === 'turn/end').length
  await view.locator('[data-composer-input]').fill(text)
  await view.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => sessionEventsOf(id).filter(event => event.type === 'turn/end').length).toBe(before + 1)
  await expect(view.getByRole('button', { name: stop })).toHaveCount(0)
}

test('真实进程重启保持侧聊归属，保存副本与再次分叉各用正确边界', async ({ page }) => {
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const question = 'OWN-SIDE: keep this question outside inherited history after restart'
  await send(side, child, question)
  if (await toggleOf(side).getAttribute('aria-expanded') === 'true') await toggleOf(side).click()
  const inherited = sessionEventsOf(child).findLast(event => event.type === 'session/end-seed' && event.data.inherited === true)!.seq - 1
  const restores = () => sessionEventsOf(child).filter(event => event.type === 'session/end-seed' && event.data.inherited !== true).length
  const before = restores()
  // Corrupt both the window cache and its shared recovery copy. Durable host
  // ownership must repair them, not merely prefer the other cached copy.
  await page.evaluate(id => {
    for (const store of [sessionStorage, localStorage]) for (const key of Object.keys(store).filter(key => key.startsWith('dsh-sidenote:side-meta:v1:'))) {
      const meta = JSON.parse(store.getItem(key)!)
      if (meta.childId === id) store.setItem(key, JSON.stringify({ ...meta, boundarySeq: 999999 }))
    }
  }, child)
  await restartHost(page)
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect.poll(restores).toBeGreaterThan(before)
  await expect(toggleOf(side)).toHaveAttribute('aria-expanded', 'false')
  await expect(side.locator('[data-chat-flow-kind="user"]')).toContainText(question)
  await expect(side.getByRole('button', { name: reflow })).toHaveCount(1)
  await expect(side.getByRole('button', { name: /^(Reflow all|整段回流)$/ })).toBeEnabled()
  await expect.poll(() => page.evaluate(id => Object.keys(sessionStorage).filter(key => key.startsWith('dsh-sidenote:side-meta:v1:')).map(key => JSON.parse(sessionStorage.getItem(key)!)).find(meta => meta.childId === id)?.boundarySeq, child)).toBe(inherited)
  await page.screenshot({ path: test.info().outputPath('recovered-side-chat.png') })
  await toggleOf(side).click()
  await expect(side.locator('[data-sidenote-context-progress]')).not.toContainText(question)
  await toggleOf(side).click()
  await send(side, child, 'OWN-FOLLOWUP: continue the same side conversation')
  expect(userMessagesOf(child).filter(text => text.includes('<mainline-progress-snapshot '))).toHaveLength(1)
  await side.getByRole('button', { name: reflow }).last().click()
  await expect(page.getByText(/1 side-chat reflow|1 条侧边回流/).first()).toBeVisible()

  await side.getByRole('button', { name: /^(Save as session|保存为正式会话)$/ }).click()
  await expect(side).toHaveCount(0)
  const saved = page.locator('[data-conversation-session]').first()
  await expect(saved).not.toHaveAttribute('data-conversation-session', process.env.DSH_E2E_SEED_SESSION!)
  const savedId = (await saved.getAttribute('data-conversation-session'))!
  await restartHost(page)
  await expect(saved).toHaveAttribute('data-conversation-session', savedId)
  await expect(saved.locator('[data-chat-flow-kind="user"]')).toHaveCount(2)
  await expect(saved.locator('[data-chat-flow-kind="user"]').first()).toContainText(question)
  await toggleOf(saved).click()
  await expect(saved.locator('[data-sidenote-context-progress]')).not.toContainText(question)

  await page.getByRole('button', { name: /Open a side chat|打开侧边聊天/ }).first().click()
  await expect(side.locator('[data-composer-input]')).toBeVisible()
  const nextChild = (await side.getAttribute('data-sidenote-chat-session'))!
  expect(nextChild).not.toBe(child)
  if (await toggleOf(side).getAttribute('aria-expanded') !== 'true') await toggleOf(side).click()
  await expect(side.locator('[data-sidenote-context-progress]')).toContainText(question)
  await expect(side.locator('[data-chat-flow-kind="user"]')).toHaveCount(0)
  await selectModel(page, side, 'Controlled E2E')
  await send(side, nextChild, 'NEW-SIDE: only this new exchange belongs to this side chat')
  await expect(side.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
  await expect(side.getByRole('button', { name: reflow })).toHaveCount(1)
})

test('另一个窗口启动和关闭后，原窗口仍恢复同一个侧聊', async ({ page }) => {
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  await send(side, child, 'WINDOW-ONE: preserve this side session')
  const second = await page.context().newPage()
  await prepareSeedPage(second)
  await second.close()
  await send(side, child, 'WINDOW-ONE: still the same side session')
  await page.reload()
  await expect(side).toHaveAttribute('data-sidenote-chat-session', child)
  await expect(side.locator('[data-chat-flow-kind="user"]')).toHaveCount(2)
  await expect(side.getByRole('button', { name: reflow })).toHaveCount(2)
})

test('恢复身份缺失时提示找回，不悄悄新建侧聊', async ({ page }) => {
  await prepareSeedPage(page)
  await openSideChat(page)
  await page.addInitScript(() => {
    for (const store of [sessionStorage, localStorage]) for (const key of Object.keys(store)) {
      if (key.startsWith('dsh-sidenote:side-meta:v1:') || key.startsWith('dsh-sidenote:closed-side:v1:')) store.removeItem(key)
    }
  })
  let forks = 0
  page.on('request', request => { if (request.url().endsWith('/api/session/fork')) forks++ })
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: /original side chat could not be restored|未能恢复原侧聊/ })).toBeVisible()
  await expect(sideChatOf(page)).toHaveCount(0)
  expect(forks).toBe(0)
})
