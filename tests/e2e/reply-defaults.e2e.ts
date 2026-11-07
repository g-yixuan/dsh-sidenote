import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHostApi, restartHost } from './host'
import { dragText, openGeneralSettings, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('reply-default-failure.png') })
})

interface SettingsRow { ns: string; revision: number; value: Record<string, unknown> }
async function settings<T>(method: 'describe' | 'mutate', args: Record<string, unknown> = {}): Promise<T> {
  const api = await createHostApi()
  try {
    const response = await api.post(`/api/settings/${method}`, {
      data: { type: 'client-request', rpcId: randomUUID(), method: `settings/${method}`, payload: { args } },
    })
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.result?.ok).toBe(true)
    return body.result.value as T
  } finally { await api.dispose() }
}
async function configuration(ns: string): Promise<SettingsRow> {
  const view = await settings<{ namespaces: SettingsRow[] }>('describe')
  const row = view.namespaces.find(row => row.ns === ns)
  expect(row).toBeDefined()
  return row!
}
async function configure(ns: string, patch: Record<string, unknown>): Promise<void> {
  const { revision } = await configuration(ns)
  await settings('mutate', { ns, expectedRevision: revision, ops: Object.entries(patch).map(([key, value]) => ({ op: 'set', path: [key], value })) })
}
const finalChoice = /^(Final answer only|仅最终回答)$/
const allChoice = /^(All replies|全部回复)$/
const closeSettings = (page: Page) => page.getByRole('dialog', { name: /^(Settings|设置)$/ }).getByRole('button', { name: /^(Close(?: settings)?|关闭(?:设置)?)$/i }).click()

for (const real of [false, true]) test(`${real ? 'official Flash ' : ''}folded replies initialize once and preserve an opt-out across reload and restart`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_REAL_MODEL, 'Set DSH_E2E_REAL_KEY_FILE for real Flash verification')
  test.setTimeout(240_000)
  // Every previous test page is closed. Seed a saved all choice before this
  // client's first load, exercising an upgrade as well as a fresh install.
  await configure('ui-chat', { foldedReplies: 'all', transcriptView: 'detailed', collapseTiming: 'completion' })
  await configure('side-chat', { finalRepliesDefaultAttempted: false })
  await prepareSeedPage(page)
  await expect.poll(async () => (await configuration('ui-chat')).value.foldedReplies).toBe('final')
  await expect.poll(async () => (await configuration('side-chat')).value.finalRepliesDefaultAttempted).toBe(true)
  const chatSettings = (await configuration('ui-chat')).value
  expect(chatSettings).toMatchObject({ transcriptView: 'detailed', collapseTiming: 'completion' })
  await openGeneralSettings(page)
  await expect(page.getByRole('button', { name: finalChoice })).toBeVisible()
  await page.screenshot({ path: `test-results/reply-default-${real ? 'flash' : 'controlled'}-settings.png` })
  await closeSettings(page)

  const mainId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator('[data-conversation-session]').first()
  const responses = main.locator('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])')
  await expect(responses.filter({ hasText: 'Reading the README and listing the workspace files in parallel.' })).toBeHidden()
  await selectModel(page, main, real ? 'DeepSeek Flash (official E2E)' : 'Controlled E2E')
  const marker = 'FINAL-' + randomUUID()
  writeFileSync(join(process.env.DSH_E2E_WORKSPACE!, 'reply-default.txt'), marker + '\n')
  const before = sessionEventsOf(mainId).at(-1)!.seq
  const prompt = real
    ? '先简短说明正在核对文件，然后调用 read 工具读取当前工作区 reply-default.txt。最终回答只回复文件中的完整标记，不调用其他工具。'
    : 'Verify the final reply selection toolbar.'
  await main.locator('[data-composer-input]').fill(prompt)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => sessionEventsOf(mainId).some(event => event.seq > before && event.type === 'turn/end' && event.data.reason.kind === 'completed'), { timeout: 90_000 }).toBe(true)
  const quote = real ? marker : 'complete assistant response'
  const answer = responses.filter({ hasText: quote }).last()
  await expect(answer).toBeVisible()
  if (real) expect(sessionEventsOf(mainId).some(event => event.seq > before && event.type === 'tool/result' && JSON.stringify(event.data).includes(marker))).toBe(true)
  await dragText(page, answer, quote)
  const toolbar = page.locator('[data-dsh-sidenote] [role="toolbar"]')
  await expect(toolbar).toBeVisible()
  await page.screenshot({ path: `test-results/reply-default-${real ? 'flash' : 'controlled'}-selection.png` })
  await toolbar.getByRole('button', { name: /^(Add to conversation|添加到对话)$/ }).click()
  await page.locator('[data-dsh-sidenote] input').press('Enter')
  const followup = '不要调用工具，只回复：引用核验通过'
  const beforeFollowup = sessionEventsOf(mainId).at(-1)!.seq
  await main.locator('[data-composer-input]').fill(followup)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => sessionEventsOf(mainId).some(event => event.seq > beforeFollowup && event.type === 'turn/end' && event.data.reason.kind === 'completed'), { timeout: 90_000 }).toBe(true)
  expect(userMessagesOf(mainId).findLast(text => text.includes(followup))).toContain(`<quote>${quote}</quote>`)
  if (real) await expect(responses.filter({ hasText: '引用核验通过' }).last()).toBeVisible()

  await openGeneralSettings(page)
  await page.getByRole('button', { name: finalChoice }).click()
  await page.getByRole('menuitem', { name: allChoice }).click()
  await expect.poll(async () => (await configuration('ui-chat')).value.foldedReplies).toBe('all')
  await closeSettings(page)
  await page.reload()
  await prepareSeedPage(page)
  await expect.poll(async () => (await configuration('ui-chat')).value.foldedReplies).toBe('all')
  await restartHost(page)
  await prepareSeedPage(page)
  await openGeneralSettings(page)
  await expect(page.getByRole('button', { name: allChoice })).toBeVisible()
  expect((await configuration('side-chat')).value.finalRepliesDefaultAttempted).toBe(true)
  await page.screenshot({ path: `test-results/reply-default-${real ? 'flash' : 'controlled'}-restart.png` })
  await closeSettings(page)
  if (real) {
    const wireFile = join(process.env.DSH_E2E_HOME!, '..', 'official-wire.json')
    const wire = JSON.parse(readFileSync(wireFile, 'utf8')) as { model: string; status: number; finished?: boolean }[]
    expect(wire.length).toBeGreaterThanOrEqual(3)
    expect(wire.every(request => request.model === 'deepseek-flash' && request.status === 200 && request.finished)).toBe(true)
    writeFileSync('test-results/reply-default-flash-wire.json', JSON.stringify(wire, null, 2) + '\n')
  }
  writeFileSync(`test-results/reply-default-${real ? 'flash' : 'controlled'}.json`, JSON.stringify({ model: real ? 'deepseek-flash' : 'controlled', initialAllOverridden: true, finalAnswerSelected: true, annotationSent: true, optOutSurvivesReloadAndRestart: true }, null, 2) + '\n')
})
