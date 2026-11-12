/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest'
import { captureDocumentSelection } from '../src/client/documents/selection.ts'
import { quoteClipOf } from '../src/client/host/dom.ts'

afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren() })

function preview(kind = 'markdown', path = 'docs/说明.md', sessionId = 'main') {
  const view = document.createElement('div')
  view.dataset.sidebarRightSession = sessionId
  view.innerHTML = '<div data-document-preview><header>文档工具栏</header><div data-textpreview-body></div></div>'
  const root = view.querySelector<HTMLElement>('[data-document-preview]')!
  root.dataset.documentPreview = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/' + kind
  root.dataset.textpreviewUrl = `dsh-resource://file/session/${sessionId}/${path.split('/').map(encodeURIComponent).join('/')}`
  const body = root.querySelector<HTMLElement>('[data-textpreview-body]')!
  body.innerHTML = '<div data-document-markdown><p>第一段说明</p><p>第二段说明</p></div>'
  document.body.append(view)
  return { view, root, body }
}

function select(start: Node, end = start, startOffset = 0, endOffset = end.nodeType === Node.TEXT_NODE ? end.textContent!.length : end.childNodes.length) {
  const range = document.createRange()
  range.setStart(start, startOffset); range.setEnd(end, endOffset)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
}

it('captures a rendered Markdown excerpt and its decoded source, omitting code controls', () => {
  const p = preview()
  const body = p.body.querySelector('[data-document-markdown]')!
  body.innerHTML = '<p>正文</p><table><tr><td>键</td><td>值</td></tr><tr><td>名称</td><td>说明</td></tr></table><div data-code-block-banner>Copy</div><pre><code>const n = 1\nconst m = 2</code></pre><p>结尾</p>'
  select(body)
  const captured = captureDocumentSelection('main')!
  expect(captured.source).toEqual({ sessionId: 'main', path: 'docs/说明.md' })
  expect(captured.text).toContain('const n = 1\nconst m = 2')
  expect(captured.text).toContain('正文')
  expect(captured.text).not.toContain('Copy')
  expect(captured.text).toContain('键\t值\n名称\t说明')
  expect(captureDocumentSelection('other-main')).toBeNull()
})

it.each(['text', 'code'])('captures only the official %s content body', kind => {
  const p = preview(kind, 'src/example.ts')
  p.body.innerHTML = kind === 'text' ? '<div data-textpreview-plain><pre data-textpreview-line="1">plain text</pre></div>'
    : '<div data-code-preview><div data-code-block-banner>Copy</div><div data-code-block-content><pre>const n = 1</pre></div></div>'
  select(p.body.querySelector('pre')!.firstChild!)
  expect(captureDocumentSelection('main')?.text).toBe(kind === 'text' ? 'plain text' : 'const n = 1')
  select(p.root.querySelector('header')!.firstChild!)
  expect(captureDocumentSelection('main')).toBeNull()
})

it.each(['pdf', 'office'])('keeps the %s source path and page range from selected text layers', kind => {
  const p = preview(kind, kind === 'pdf' ? 'paper.pdf' : 'notes.docx')
  p.body.innerHTML = '<section data-pdf-preview><div data-pdf-page="2"><div data-pdf-text>第2页文本</div></div><div data-pdf-page="3"><div data-pdf-text>第3页文本</div></div></section>'
  const layers = p.body.querySelectorAll('[data-pdf-text]')
  select(layers[0]!.firstChild!, layers[1]!.firstChild!)
  expect(captureDocumentSelection('main')?.source).toEqual({ sessionId: 'main', path: kind === 'pdf' ? 'paper.pdf' : 'notes.docx', pageStart: 2, pageEnd: 3 })
  p.body.querySelector('[data-pdf-page="3"]')!.insertAdjacentHTML('beforebegin', '<p>页面正在加载</p>')
  expect(captureDocumentSelection('main')).toBeNull()
})

it('rejects mixed documents, unsupported renderers and removed source bodies', () => {
  const first = preview(), second = preview()
  select(first.body.querySelector('p')!.firstChild!, second.body.querySelector('p')!.firstChild!)
  expect(captureDocumentSelection('main')).toBeNull()
  select(first.body.querySelector('p')!.firstChild!)
  first.root.dataset.documentPreview = 'third-party/markdown'
  expect(captureDocumentSelection('main')).toBeNull()
  first.root.dataset.documentPreview = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html'
  expect(captureDocumentSelection('main')).toBeNull()
  first.view.remove()
  expect(captureDocumentSelection('main')).toBeNull()
})

it('keeps document geometry independent from a composer in another sidebar pane', () => {
  const p = preview()
  const rect = (top: number, bottom: number) => ({ left: 0, right: 500, top, bottom, width: 500, height: bottom - top }) as DOMRect
  p.view.getBoundingClientRect = () => rect(0, 600)
  p.root.getBoundingClientRect = () => rect(100, 500)
  const composer = document.createElement('div')
  composer.dataset.composerSeat = ''
  composer.getBoundingClientRect = () => rect(40, 80)
  p.view.prepend(composer)
  select(p.body.querySelector('p')!.firstChild!)
  const captured = captureDocumentSelection('main')!
  expect(captured.view).toBe(p.root)
  expect(quoteClipOf(captured.body, captured.view)).toMatchObject({ top: 100, bottom: 500 })
})
