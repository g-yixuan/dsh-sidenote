import { expect, test, type Locator, type Page } from '@playwright/test'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareSeedPage, registerSeedWorkspace, selectModel, userMessagesOf, sessionEventsOf } from './journey'

test.beforeAll(async () => {
  const workspace = process.env.DSH_E2E_WORKSPACE!
  writeFileSync(join(workspace, 'document-notes.md'), '# Reading notes\n\nMarkdown excerpt marker.\n\n- First list item\n- Second list item\n\n```ts\nconst excerpt = "complete code"\n```\n')
  writeFileSync(join(workspace, 'document-code.ts'), 'const documentExcerpt = "code marker"\nconst second = 2\n')
  writeFileSync(join(workspace, 'document-plain.txt'), 'Plain text excerpt marker\nSecond line\n')
  for (const name of ['paper.pdf', 'notes.docx', 'slides.pptx']) copyFileSync(fileURLToPath(new URL('../fixtures/document-quotes/' + name, import.meta.url)), join(workspace, name))
  await registerSeedWorkspace()
})
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('document-quotes-failure.png') })
})

const toolbar = (page: Page) => page.locator('[data-sidenote-document-ui] [role="toolbar"]')
const docChip = (main: Locator) => main.locator('[data-context-kind="documents"]')

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await prepareSeedPage(page)
  const seed = page.locator('[data-conversation-session]').first()
  const seedId = await seed.getAttribute('data-conversation-session')
  await seed.getByRole('button', { name: /^(Branch into a new conversation|在新对话中分支)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', seedId!)
  await selectModel(page, main, 'Controlled E2E')
  await page.keyboard.press('ControlOrMeta+Alt+p')
  await expect(page.locator('[data-files-page]')).toBeVisible()
  return { main, id: (await main.getAttribute('data-conversation-session'))! }
}

async function openFile(page: Page, name: string) {
  const row = page.getByRole('button', { name, exact: true }).first()
  if (!await row.isVisible()) await page.keyboard.press('ControlOrMeta+Alt+p')
  await expect(row).toBeVisible()
  await row.click()
  const preview = page.locator('[data-document-preview]:visible').filter({ has: page.locator('[data-textpreview-path]').filter({ hasText: name }) }).last()
  await expect(preview).toBeVisible()
  return preview
}

/** Real pointer selection inside a file's own scrollport, including PDF text layers. */
async function drag(page: Page, body: Locator, text: string) {
  const target = body.getByText(text, { exact: false }).first()
  await target.scrollIntoViewIfNeeded()
  await target.click({ trial: true })
  await page.evaluate(() => document.fonts.ready)
  const points = await body.evaluate((el, needle) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
    const full = nodes.map(node => node.data).join('')
    const at = full.indexOf(needle)
    if (at < 0) return null
    const boundary = (offset: number) => {
      for (const node of nodes) {
        if (offset < node.length) return { node, offset }
        offset -= node.length
      }
      return null
    }
    const first = boundary(at), last = boundary(at + needle.length - 1)
    if (!first || !last) return null
    const a = document.createRange(), b = document.createRange()
    a.setStart(first.node, first.offset); a.setEnd(first.node, first.offset + 1)
    b.setStart(last.node, last.offset); b.setEnd(last.node, last.offset + 1)
    const pdf = el.matches('[data-pdf-preview]')
    const start = pdf ? first.node.parentElement!.getBoundingClientRect() : a.getBoundingClientRect()
    const end = pdf ? last.node.parentElement!.getBoundingClientRect() : b.getBoundingClientRect()
    return { x1: start.left + .1, y1: start.top + start.height / 2, x2: Math.max(end.right, b.getBoundingClientRect().right) + 3, y2: end.top + end.height / 2 }
  }, text)
  expect(points).not.toBeNull()
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await page.mouse.move(points!.x1 + 2, points!.y1); await page.mouse.down()
  await page.mouse.move(points!.x2, points!.y2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain(text)
  await expect(toolbar(page).getByRole('button', { name: /Add to main conversation|添加到主对话/ })).toBeEnabled()
}

test('document quotes: Markdown, code and plain text accumulate, survive reload and travel in one durable message', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  const { main, id } = await start(page)
  const preview = await openFile(page, 'document-notes.md')
  await drag(page, preview.locator('[data-document-markdown]'), 'Markdown excerpt marker.')
  await toolbar(page).getByRole('button').click()
  await expect(docChip(main)).toHaveText(/×1/)
  await expect(page.locator('[data-dsh-sidenote] textarea')).toHaveCount(0)
  await expect(page.locator('[data-dsh-sidenote] button[class*="badge"]')).toHaveCount(0)
  // The official file navigator remains available beside the preview.
  for (const [file, text, selector] of [
    ['document-code.ts', 'const documentExcerpt = "code marker"', '[data-code-block-content]'],
    ['document-plain.txt', 'Plain text excerpt marker', '[data-textpreview-plain]'],
  ]) {
    const filePreview = await openFile(page, file!)
    await drag(page, filePreview.locator(selector!), text!)
    await toolbar(page).getByRole('button').click()
  }
  await expect(docChip(main)).toHaveText(/×3/)
  await page.reload()
  await expect(docChip(main)).toHaveText(/×3/)
  await docChip(main).click()
  const panel = page.locator('[data-sidenote-context-preview]')
  await expect(panel).toContainText('document-notes.md')
  await expect(panel).toContainText('Plain text excerpt marker')
  await expect(panel.locator('textarea')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/document-quotes-draft.png' })
  await page.keyboard.press('Escape')
  const marker = 'Explain the collected document excerpts. [e2e:document-quotes]'
  const before = sessionEventsOf(id).filter(event => event.type === 'turn/end').length
  await main.locator('[data-composer-input]').fill(marker)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(id).filter(text => text.includes(marker)).length).toBe(1)
  const wire = userMessagesOf(id).find(text => text.includes(marker))!
  expect(wire).toContain('document-notes.md'); expect(wire).toContain('document-code.ts'); expect(wire).toContain('document-plain.txt')
  expect(wire.match(/<document-quote /g)).toHaveLength(3)
  await expect(docChip(main)).toHaveCount(0)
  await expect.poll(() => sessionEventsOf(id).filter(event => event.type === 'turn/end').length).toBe(before + 1)
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText('Document sources and complete excerpts reached the model adapter.')
  const bubble = main.locator('[data-chat-flow-kind="user"]').filter({ hasText: marker }).last()
  await bubble.getByRole('button', { name: /Document quotes|文档引用/ }).click()
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText('Markdown excerpt marker.')
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText('code marker')
  await page.screenshot({ path: 'test-results/document-quotes-sent.png' })
  await page.keyboard.press('Escape')
  await page.reload()
  await bubble.getByRole('button', { name: /Document quotes|文档引用/ }).click()
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText('Markdown excerpt marker.')
  const remaining = await page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), id)
  expect(remaining).toEqual([])
  expect(errors).toEqual([])
})

for (const [file, text] of [['paper.pdf', 'PDF first page'], ['notes.docx', 'Office excerpt'], ['slides.pptx', 'Slide excerpt']]) {
  test(`document quotes: ${file} uses the original source and PDF page number`, async ({ page }) => {
    const { main, id } = await start(page)
    const preview = await openFile(page, file!)
    await expect(preview.locator('[data-pdf-text]').filter({ hasText: text! }).first()).toBeVisible({ timeout: 120_000 })
    await drag(page, preview.locator('[data-pdf-preview]'), text!)
    const selected = await page.evaluate(() => window.getSelection()!.toString())
    await toolbar(page).getByRole('button').click()
    await docChip(main).click()
    const panel = page.locator('[data-sidenote-context-preview]')
    await expect(panel).toContainText(file!)
    await expect(panel).toContainText(/Page 1|第 1 页/)
    await expect(panel).toContainText(text!)
    await page.screenshot({ path: `test-results/document-quotes-${file}.png` })
    const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), id)
    expect(stored).toMatchObject([{ text: selected, document: { path: file, pageStart: 1, pageEnd: 1 } }])
    await page.keyboard.press('Escape')
    if (file === 'paper.pdf') {
      const points = await preview.evaluate(el => {
        const first = el.querySelector('[data-pdf-page="1"] [data-pdf-text] span')!.getBoundingClientRect()
        const last = el.querySelector('[data-pdf-page="2"] [data-pdf-text] span')!.getBoundingClientRect()
        return { x1: first.left + 2, y1: first.top + first.height / 2, x2: last.left + last.width * .85, y2: last.top + last.height / 2 }
      })
      await page.evaluate(() => window.getSelection()?.removeAllRanges())
      await page.mouse.move(points.x1, points.y1); await page.mouse.down()
      await page.mouse.move(points.x2, points.y2, { steps: 20 }); await page.mouse.up()
      const across = await page.evaluate(() => window.getSelection()!.toString())
      expect(across).toContain('PDF first page'); expect(across).toContain('PDF second page')
      await toolbar(page).getByRole('button').click()
      await docChip(main).click()
      await expect(page.locator('[data-sidenote-context-preview]')).toContainText(/Pages 1–2|第 1–2 页/)
      const records = await page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), id)
      expect(records[1]).toMatchObject({ text: across, document: { path: file, pageStart: 1, pageEnd: 2 } })
      await page.screenshot({ path: 'test-results/document-quotes-pdf-cross-page.png' })
      await page.keyboard.press('Escape')
    }
    await page.reload()
    await expect(docChip(main)).toHaveText(file === 'paper.pdf' ? /×2/ : /×1/)
  })
}
