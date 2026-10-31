import { expect, test, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
  await expect.poll(() => sessionEventsOf(id).filter(event => event.type === 'turn/end').length, { timeout: 90_000 }).toBe(before + 1)
  expect(sessionEventsOf(id).findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
  await expect(view.getByRole('button', { name: stop })).toHaveCount(0)
}

// The native account lane keeps its private grant in the isolated DSH_HOME
// across real process restarts.
for (const real of [false, true]) test(`${real ? 'account Flash ' : ''}真实进程重启保持侧聊归属，保存副本与再次分叉各用正确边界`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_ACCOUNT_MODEL, 'Requires an isolated native DeepSeek account')
  test.setTimeout(real ? 360_000 : 180_000)
  const model = real ? process.env.DSH_E2E_ACCOUNT_MODEL! : 'Controlled E2E'
  const marker = 'SIDE-' + randomUUID()
  if (real) writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, 'recovery-code.txt'), marker + '\n')
  await prepareSeedPage(page)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, model)
  const question = real ? '调用 read 读取 recovery-code.txt，记住其中的侧聊核验码，只回复“记住了”。' : 'OWN-SIDE: keep this question outside inherited history after restart'
  await send(side, child, question)
  if (real) expect(sessionEventsOf(child).some(event => event.type === 'tool/result' && JSON.stringify(event.data).includes(marker))).toBe(true)
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
  await send(side, child, real ? '不要调用工具，只回复本侧聊之前读到的完整核验码。' : 'OWN-FOLLOWUP: continue the same side conversation')
  if (real) await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(marker)
  expect(userMessagesOf(child).filter(text => text.includes('<mainline-progress-snapshot '))).toHaveLength(1)
  await side.getByRole('button', { name: reflow }).last().click()
  await expect(page.getByText(/1 side-chat reflow|1 条侧边回流/).first()).toBeVisible()
  if (real) {
    const main = page.locator('[data-conversation-session]').first()
    await selectModel(page, main, model)
    await send(main, process.env.DSH_E2E_SEED_SESSION!, '不要调用工具，只复述刚才侧边回流中给出的完整核验码。')
    await expect(main.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(marker)
  }

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
  await selectModel(page, side, model)
  await send(side, nextChild, real ? '不要调用工具，只回复之前读取的完整侧聊核验码。' : 'NEW-SIDE: only this new exchange belongs to this side chat')
  if (real) await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(marker)
  await expect(side.locator('[data-chat-flow-kind="user"]')).toHaveCount(1)
  await expect(side.getByRole('button', { name: reflow })).toHaveCount(1)
  if (real) {
    const wire = () => JSON.parse(readFileSync(join(process.env.DSH_E2E_HOME!, '..', 'official-wire.json'), 'utf8')) as { model: string; status: number }[]
    // Native Messages cancels its fetch after message_stop. Durable completed
    // turns above establish completion even when the passive clone is aborted.
    expect(wire().length).toBeGreaterThanOrEqual(5)
    expect(wire().every(record => record.model === 'deepseek-flash' && record.status === 200)).toBe(true)
    writeFileSync(test.info().outputPath('real-recovery.json'), JSON.stringify({ model, marker, child, savedId, nextChild, completed: true, requests: wire() }, null, 2) + '\n')
  }
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
