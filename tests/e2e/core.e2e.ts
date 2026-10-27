import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sessionEventsOf, sideChatOf, userMessagesOf } from './journey'

test.beforeAll(registerSeedWorkspace)

test('shared host journey: real fork, inherited history, accepted side message and session isolation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await prepareSeedPage(page)
  // Decorating the native View must not add a fallback-labelled empty tab.
  await expect(page.getByRole('tab', { name: 'Chat', exact: true })).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'chat', exact: true })).toHaveCount(0)
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).some(text => text.includes('I forked the main session'))).toBe(true)
  // A real completed turn has turn/end after its last legacy message; seeded
  // historical nodes alone do not reproduce the orphaned footer regression.
  const parentId = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${parentId}"]`)
  await selectModel(page, main, 'Controlled E2E')
  const ended = sessionEventsOf(parentId).filter(event => event.type === 'turn/end').length
  await main.locator('[data-composer-input]').fill('Complete a native turn before testing inherited folding')
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => sessionEventsOf(parentId).filter(event => event.type === 'turn/end').length).toBe(ended + 1)
  const child = await openSideChat(page)
  await expect(page.getByRole('tab', { name: 'chat', exact: true })).toHaveCount(0)
  const side = sideChatOf(page)
  const inherited = side.getByRole('button', { name: /Main conversation context|主线上下文/ })
  await inherited.click()
  await expect(side.locator('[data-turn-tail]')).toHaveCount(0)
  await inherited.click()
  await expect(side.locator('[data-turn-tail]')).toHaveCount(0)
  await expect(side.locator('[data-sidenote-context-history]')).toContainText('Complete a native turn before testing inherited folding')
  // Read-only context preserves the full call and result without mounting a
  // second native Conversation (and its running/queue/scroll machinery).
  const tool = side.locator('details[data-context-kind="tool"]').filter({ hasText: 'ls -1' }).first()
  await tool.locator('summary').click()
  await expect(tool).toContainText('ls -1')
  await expect(tool).toContainText('package.json')
  const input = side.locator('[data-composer-input]')
  const message = 'Shared host journey: send to this child only'
  await input.fill(message)
  await input.press('Enter')
  // An optimistic bubble or cleared draft alone does not prove admission.
  await expect.poll(() => userMessagesOf(child).some(text => text.includes(message)), { timeout: 30_000 }).toBe(true)
  expect(userMessagesOf(process.env.DSH_E2E_SEED_SESSION!).some(text => text.includes(message))).toBe(false)
  await expect(input).toHaveText('')
  await expect(side.getByText(message, { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  writeFileSync('test-results/shared-host-admission.json', JSON.stringify({
    parent: process.env.DSH_E2E_SEED_SESSION,
    child,
    acceptedText: userMessagesOf(child).find(text => text.includes(message)),
    parentReceived: false,
  }, null, 2) + '\n')
  await page.screenshot({ path: 'test-results/shared-host-journey.png' })
})

test('shared host journey: multi-turn side context and an explicit conclusion returned to the parent', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await prepareSeedPage(page)
  const parent = process.env.DSH_E2E_SEED_SESSION!
  const main = page.locator(`[data-conversation-session="${parent}"]`)
  await selectModel(page, main, 'Controlled E2E')
  const mainInput = main.locator('[data-composer-input]')
  const completed = (id: string) => sessionEventsOf(id).filter(event => event.type === 'turn/end' && event.data.reason?.kind === 'completed').length
  const parentEnded = completed(parent)
  await mainInput.fill('Parent is ready to receive an explicitly returned side conclusion.')
  await mainInput.press('Enter')
  await expect.poll(() => completed(parent)).toBe(parentEnded + 1)
  const parentBefore = userMessagesOf(parent)
  const returnedMessages = () => sessionEventsOf(parent).filter(event => event.type === 'user/message' && event.data.source?.kind === 'dsh-sidenote')
  const returnedBefore = returnedMessages().length

  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, 'Controlled E2E')
  const input = side.locator('[data-composer-input]')
  const childEnded = completed(child)
  const first = '[e2e:reflow] Remember the conclusion code SIDENOTE_SIDE_BLUE.'
  const second = '[e2e:reflow] Return the remembered code as the final conclusion.'
  await input.fill(first); await input.press('Enter')
  await expect(side.getByText('Remembered SIDENOTE_SIDE_BLUE in this side conversation.', { exact: true })).toBeVisible()
  await expect.poll(() => completed(child)).toBe(childEnded + 1)
  await input.fill(second); await input.press('Enter')
  await expect(side.getByText('Conclusion: SIDENOTE_SIDE_BLUE.', { exact: true })).toBeVisible()
  await expect.poll(() => completed(child)).toBe(childEnded + 2)
  expect(userMessagesOf(child).filter(text => text === first || text === second)).toEqual([first, second])
  expect(userMessagesOf(parent)).toEqual(parentBefore)

  const sideBefore = userMessagesOf(child)
  const parentDraft = 'Use the returned side conclusion in this main conversation.'
  await mainInput.fill(parentDraft)
  await side.getByRole('button', { name: /^(Bring back to main conversation|带回主对话)$/ }).last().click()
  await expect(page.getByText(/1 side-chat reflow|1 条侧边回流/).first()).toBeVisible()
  await expect.poll(() => mainInput.evaluate(el => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.textContent ?? '')).toBe(parentDraft)
  expect(userMessagesOf(parent)).toEqual(parentBefore)
  await mainInput.press('Enter')
  await expect.poll(() => completed(parent)).toBe(parentEnded + 2)
  expect(returnedMessages().length).toBe(returnedBefore)
  const returned = userMessagesOf(parent).slice(parentBefore.length)
  expect(returned).toHaveLength(1)
  expect(returned[0]).toContain('<答>Conclusion: SIDENOTE_SIDE_BLUE.</答>')
  expect(returned[0]).toContain(`<问>${second}</问>`)
  expect(returned[0]?.endsWith(parentDraft)).toBe(true)
  expect(returned[0]!.match(/<reflow source=/g)).toHaveLength(1)
  await expect(main.getByText('Main received SIDENOTE_SIDE_BLUE.', { exact: true })).toBeVisible()
  const sentBubble = main.locator('[data-chat-flow-kind="user"] [class$="_bubble"]').filter({ hasText: parentDraft })
  const sentReflow = sentBubble.getByRole('button', { name: /Side-chat context|含侧边回流上下文/ })
  await expect(sentReflow).toBeVisible()
  await sentReflow.click()
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText(second)
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText('Conclusion: SIDENOTE_SIDE_BLUE.')
  await sentReflow.click()
  expect(userMessagesOf(child)).toEqual(sideBefore)
  await expect(page.getByText(/1 side-chat reflow|1 条侧边回流/)).toHaveCount(0)
  expect(errors).toEqual([])
  writeFileSync('test-results/shared-host-reflow.json', JSON.stringify({ parent, child, multiTurnContext: true, parentUnchangedBeforeSend: true, returnedQuestion: second, returnedConclusion: 'SIDENOTE_SIDE_BLUE', sourceKind: 'user', reflowOccurrences: 1, modelReceivedConclusion: true, childUnchangedAfterReturn: true }, null, 2) + '\n')
  await page.screenshot({ path: 'test-results/shared-host-reflow.png' })
  await page.reload()
  await expect(sentReflow).toBeVisible()
  expect(returnedMessages().length).toBe(returnedBefore)
})
