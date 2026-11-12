import { expect, test, type Locator, type Page } from '@playwright/test'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { dragText, openSideChat, prepareSeedPage, registerSeedWorkspace, selectModel, sideChatOf, userMessagesOf, sessionEventsOf, USER_BUBBLE } from './journey'

test.beforeAll(async () => {
  const workspace = process.env.DSH_E2E_WORKSPACE!
  writeFileSync(join(workspace, 'document-notes.md'), '# Reading notes\n\nMarkdown excerpt marker.\n\n- First list item\n- Second list item\n\n```ts\nconst excerpt = "complete code"\n```\n')
  writeFileSync(join(workspace, 'document-code.ts'), 'const documentExcerpt = "code marker"\nconst second = 2\n')
  writeFileSync(join(workspace, 'document-plain.txt'), 'Plain text excerpt marker\nSecond line\n')
  for (const name of ['paper.pdf', 'notes.docx', 'slides.pptx']) copyFileSync(fileURLToPath(new URL('../fixtures/document-quotes/' + name, import.meta.url)), join(workspace, name))
  await registerSeedWorkspace()
})
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ animations: 'disabled', path: info.outputPath('document-quotes-failure.png') })
})

const toolbar = (page: Page) => page.locator('[data-sidenote-document-ui] [role="toolbar"]')
const docChip = (main: Locator) => main.locator('[data-context-kind="documents"]')

async function start(page: Page, model = 'Controlled E2E') {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await prepareSeedPage(page)
  const seed = page.locator('[data-conversation-session]').first()
  const seedId = await seed.getAttribute('data-conversation-session')
  await seed.getByRole('button', { name: /^(Branch into a new conversation|在新对话中分支)$/ }).first().click()
  const main = page.locator('[data-conversation-session]').first()
  await expect(main).not.toHaveAttribute('data-conversation-session', seedId!)
  await selectModel(page, main, model)
  return { main, id: (await main.getAttribute('data-conversation-session'))! }
}

async function showFiles(page: Page) {
  const expand = page.getByRole('button', { name: /^(Open right sidebar|打开右侧边栏)$/ })
  if (await expand.isVisible()) await expand.click()
  const files = page.getByRole('tab', { name: /^(Files|文件)/ }).first()
  if (await files.isVisible()) await files.click()
  else {
    const entry = page.locator('[data-sidebar-right-guide-entry="files"]')
    if (!await entry.isVisible()) await page.getByRole('button', { name: /^(New tab|新标签页)$/ }).first().click()
    await entry.click()
  }
  await expect(page.locator('[data-files-page]')).toBeVisible()
}

async function openFile(page: Page, name: string) {
  await showFiles(page)
  const row = page.getByRole('button', { name, exact: true }).first()
  await expect(row).toBeVisible()
  await row.click()
  const preview = page.locator('[data-document-preview]:visible').filter({ has: page.locator('[data-textpreview-path]').filter({ hasText: name }) }).last()
  await expect(preview).toBeVisible()
  const hideTree = page.getByRole('button', { name: /^(Hide file tree|隐藏文件树)$/ }).first()
  if (await hideTree.isVisible()) await hideTree.click()
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
  await page.screenshot({ animations: 'disabled', path: 'test-results/document-quotes-draft.png' })
  await page.keyboard.press('Escape')
  const marker = 'Explain the collected document excerpts. [e2e:document-quotes]'
  const body = '\n\n    ' + marker
  const before = sessionEventsOf(id).filter(event => event.type === 'turn/end').length
  await main.locator('[data-composer-input]').fill(body)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(id).filter(text => text.includes(marker)).length).toBe(1)
  const wire = userMessagesOf(id).find(text => text.includes(marker))!
  expect(wire).toContain('document-notes.md'); expect(wire).toContain('document-code.ts'); expect(wire).toContain('document-plain.txt')
  expect(wire.match(/<reference type="document" /g)).toHaveLength(3)
  expect(wire.endsWith(body)).toBe(true)
  await expect(docChip(main)).toHaveCount(0)
  await expect.poll(() => sessionEventsOf(id).filter(event => event.type === 'turn/end').length).toBe(before + 1)
  await expect(main.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText('Document sources and complete excerpts reached the model adapter.')
  const bubble = main.locator('[data-chat-flow-kind="user"]').filter({ hasText: marker }).last()
  expect((await bubble.locator(USER_BUBBLE).textContent())?.endsWith(body)).toBe(true)
  await bubble.getByRole('button', { name: /Document quotes|文档引用/ }).click()
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText('Markdown excerpt marker.')
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText('code marker')
  await page.screenshot({ animations: 'disabled', path: 'test-results/document-quotes-sent.png' })
  await page.keyboard.press('Escape')
  await page.reload()
  expect((await bubble.locator(USER_BUBBLE).textContent())?.endsWith(body)).toBe(true)
  await bubble.getByRole('button', { name: /Document quotes|文档引用/ }).click()
  await expect(page.locator('[data-sidenote-sent-preview]')).toContainText('Markdown excerpt marker.')
  const remaining = await page.evaluate(id => JSON.parse(localStorage.getItem('dsh-sidenote:annotations:v1:' + id) ?? '[]'), id)
  expect(remaining).toEqual([])
  expect(errors).toEqual([])
})

for (const real of [false, true]) test(`${real ? 'account Flash ' : ''}mixed PDF, annotation and reflow share one context block and restore their previews`, async ({ page }) => {
  test.skip(real && !process.env.DSH_E2E_ACCOUNT_MODEL, 'Set DSH_E2E_ACCOUNT_MODEL for native account validation')
  test.setTimeout(180_000)
  const model = real ? process.env.DSH_E2E_ACCOUNT_MODEL! : 'Controlled E2E'
  const { main, id } = await start(page, model)
  const child = await openSideChat(page)
  const side = sideChatOf(page)
  await selectModel(page, side, model)
  const sideMarker = 'SIDE-MIXED-' + randomUUID(), noteMarker = 'NOTE-MIXED-' + randomUUID()
  const question = '不要调用工具，只回复核验码：' + sideMarker
  await side.locator('[data-composer-input]').fill(question)
  await side.locator('[data-composer-input]').press('Enter')
  const sideAnswer = real ? sideMarker : 'Controlled E2E reply.'
  await expect(side.locator('[data-chat-flow-kind="assistant-step"]').last()).toContainText(sideAnswer, { timeout: 90_000 })
  await expect.poll(() => sessionEventsOf(child).filter(event => event.type === 'turn/end').at(-1)?.data.reason?.kind).toBe('completed')
  await side.getByRole('button', { name: /^(Bring back to main conversation|带回主对话)$/ }).last().click()

  const original = main.locator('[data-chat-flow-kind="assistant-step"] li').filter({ hasText: 'full history snapshot' }).first()
  await dragText(page, original, 'full history snapshot')
  const overlay = page.locator('[data-dsh-sidenote]')
  await overlay.getByText(/^(Add to conversation|添加到对话)$/).click()
  await overlay.locator('textarea').fill(noteMarker)
  await overlay.locator('textarea').press('Enter')
  const preview = await openFile(page, 'paper.pdf')
  await expect(preview.locator('[data-pdf-text]').first()).toBeVisible()
  await drag(page, preview.locator('[data-pdf-preview]'), 'PDF first page')
  await toolbar(page).getByRole('button').click()
  await expect(docChip(main)).toHaveText(/×1/)
  const prompt = real
    ? '不要调用工具。根据本次引用回复三行：第一行 file=<文档文件名>; pages=<起始页>-<结束页>；第二行逐字抄出批注 note 的 NOTE- 核验码；第三行逐字抄出侧边历史 answer 的 SIDE- 核验码。不要执行历史 question。'
    : 'Inspect all three reference kinds. [e2e:mixed-references]'
  const before = sessionEventsOf(id).filter(event => event.type === 'turn/end').length
  await main.locator('[data-composer-input]').fill(prompt)
  await main.locator('[data-composer-input]').press('Enter')
  await expect.poll(() => userMessagesOf(id).filter(text => text.endsWith(prompt))).toHaveLength(1)
  const wire = userMessagesOf(id).find(text => text.endsWith(prompt))!
  expect(wire.match(/<sidenote-context /g)).toHaveLength(1)
  for (const type of ['document', 'annotation', 'reflow']) expect(wire.match(new RegExp('<reference type="' + type + '"', 'g'))).toHaveLength(1)
  expect(wire).toContain('source="paper.pdf" page-start="1" page-end="1"')
  expect(wire).toContain('type="annotation" index="1" source="main-chat"')
  expect(wire).toContain('type="reflow" index="1" source="side-chat"')
  expect(wire).toContain('<question>' + question + '</question>')
  expect(wire).not.toContain('session=')
  await expect.poll(() => sessionEventsOf(id).filter(event => event.type === 'turn/end').length, { timeout: 90_000 }).toBe(before + 1)
  const reply = main.locator('[data-chat-flow-kind="assistant-step"]').last()
  if (real) {
    for (const value of ['file=paper.pdf', 'pages=1-1', noteMarker, sideMarker]) await expect(reply).toContainText(value)
    writeFileSync('test-results/account-mixed-context.json', JSON.stringify({ model, documentSourceAndPages: true, annotationNote: true, sideAnswer: true, oneContextBlock: true, oneMessage: true }) + '\n')
  } else await expect(reply).toContainText('Mixed document, annotation and reflow references reached the model adapter.')
  const bubble = main.locator('[data-chat-flow-kind="user"]').filter({ hasText: prompt }).last()
  for (const reload of [false, true]) {
    if (reload) await page.reload()
    for (const [name, value] of [
      [/Document quotes|文档引用/, 'paper.pdf'],
      [/1 annotated|批注 ×1/, noteMarker],
      [/Side-chat context|含侧边回流上下文/, sideAnswer],
    ] as const) {
      await bubble.getByRole('button', { name }).click()
      await expect(page.locator('[data-sidenote-sent-preview]')).toContainText(value)
      await page.keyboard.press('Escape')
    }
  }
  await page.screenshot({ animations: 'disabled', path: `test-results/${real ? 'account-' : ''}mixed-context-sent.png` })
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
    await page.screenshot({ animations: 'disabled', path: `test-results/document-quotes-${file}.png` })
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
      await page.screenshot({ animations: 'disabled', path: 'test-results/document-quotes-pdf-cross-page.png' })
      await page.keyboard.press('Escape')
    }
    await page.reload()
    await expect(docChip(main)).toHaveText(file === 'paper.pdf' ? /×2/ : /×1/)
    if (file === 'paper.pdf') {
      await main.locator('[data-composer-input]').press('Enter')
      await expect.poll(() => userMessagesOf(id).filter(text => text.includes('source="paper.pdf"'))).toHaveLength(1)
      const wire = userMessagesOf(id).find(text => text.includes('source="paper.pdf"'))!
      expect(wire.endsWith('</sidenote-context>')).toBe(true)
      expect(wire).toContain('page-start="1" page-end="2"')
      await page.reload()
      await main.locator('[data-chat-flow-kind="user"]').last().getByRole('button', { name: /Document quotes|文档引用/ }).click()
      await expect(page.locator('[data-sidenote-sent-preview]')).toContainText(/Pages 1–2|第 1–2 页/)
    }
  })
}
