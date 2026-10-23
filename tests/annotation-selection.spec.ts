/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { captureSelection } from '../src/client/annotate/selection.ts'
import { resolveRange, type CachedRange } from '../src/client/annotate/anchor.ts'
import { sourceClip } from '../src/client/annotations/source.ts'
import { createAnnotationStore } from '../src/client/annotations/model.ts'

const rect = (left = 0, top = 0, right = 400, bottom = 500) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }) as DOMRect
Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect() })
afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges() })

function side(id: string, key = 'a:1', text = 'same phrase') {
  const view = document.createElement('div')
  view.dataset.sidenoteChatSession = id
  view.dataset.dshBetterSidebar = ''
  view.innerHTML = `<div data-sidenote-message-role="assistant" data-sidenote-message-key="${key}"><div data-sidenote-quote-body data-sidenote-streaming="false"></div></div>`
  const body = view.querySelector<HTMLElement>('[data-sidenote-quote-body]')!
  body.textContent = text
  body.getClientRects = () => [rect()] as unknown as DOMRectList
  document.body.append(view)
  return { view, body }
}

function select(start: Node, startOffset = 0, end = start, endOffset = start.textContent!.length) {
  const range = document.createRange()
  range.setStart(start, startOffset); range.setEnd(end, endOffset)
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
  return range
}

describe('scoped assistant selection', () => {
  it('a side reply uses its real child and only explicit bodies bypass the legacy viewer exclusion', () => {
    const a = side('child-a')
    select(a.body.firstChild!)
    expect(captureSelection('parent')).toMatchObject({ sessionId: 'child-a', source: { surface: 'side' } })
    a.body.removeAttribute('data-sidenote-quote-body')
    expect(captureSelection('parent')).toBeNull()
  })

  it('cross-message, cross-pane, streaming and controls cannot become quotes', () => {
    const a = side('child-a'), b = side('child-b')
    select(a.body.firstChild!, 0, b.body.firstChild!)
    expect(captureSelection('parent')).toBeNull()
    select(a.body.firstChild!)
    a.body.dataset.sidenoteStreaming = 'true'
    expect(captureSelection('parent')).toBeNull()
    a.body.dataset.sidenoteStreaming = 'false'
    a.body.innerHTML = '<button>copy</button>'
    select(a.body.firstChild!.firstChild!)
    expect(captureSelection('parent')).toBeNull()
  })

  it('main local conversation identity takes precedence over the global current session', () => {
    document.body.innerHTML = '<div data-conversation-session="local"><div data-chat-anchor-key="a"><div data-chat-flow-kind="assistant-step">local reply</div></div></div>'
    select(document.querySelector('[data-chat-flow-kind]')!.firstChild!)
    expect(captureSelection('other')).toMatchObject({ sessionId: 'local', source: { surface: 'main' } })
  })

  it('removes nested code controls while retaining complete quoted code', () => {
    const a = side('child')
    a.body.innerHTML = '<p>first paragraph</p><div data-code-block-banner>ts<button>Copy</button></div><pre><code>const one = 1\nconst two = 2</code></pre><p>last paragraph</p>'
    select(a.body, 0, a.body, a.body.childNodes.length)
    const selection = captureSelection('parent')!
    expect(selection.text).toContain('first paragraph')
    expect(selection.text).toContain('const one = 1\nconst two = 2')
    expect(selection.text).toContain('last paragraph')
    expect(selection.text).not.toContain('Copy')
    expect(selection.anchorText).toBe('first paragraphconst one = 1\nconst two = 2last paragraph')
  })

  it('excludes native reasoning while whole-message selections retain the actual answer', () => {
    const a = side('child')
    a.body.innerHTML = '<div data-variant="think"><p>native reasoning</p></div><p>final answer</p>'
    select(a.body.querySelector('[data-variant="think"] p')!.firstChild!)
    expect(captureSelection('parent')).toBeNull()
    select(a.body, 0, a.body, a.body.childNodes.length)
    expect(captureSelection('parent')?.anchorText).toBe('final answer')
    expect(captureSelection('parent')?.text).toBe('final answer')
  })

  it('reanchors only within the recorded session/surface/message, and never guesses a missing occurrence', () => {
    side('wrong-child')
    const a = side('right-child', 'a:1', 'same phrase / same phrase')
    const store = createAnnotationStore(() => 1, null)
    const annotation = store.add({ sessionId: 'right-child', sourceSessionId: 'right-child', sourceSurface: 'side', anchorKey: 'a:1', text: 'same phrase', anchorText: 'same phrase', occurrence: 1, note: '' })
    const cache = new Map<number, CachedRange>()
    const restored = resolveRange(annotation, cache, 'parent')!
    expect(restored.startContainer).toBe(a.body.firstChild)
    expect(restored.startOffset).toBe(14)
    a.body.textContent = 'same phrase'
    expect(resolveRange(annotation, cache, 'parent')).toBeNull()
    expect(store.get(annotation.id)?.state).toBe('active')
  })

  it('ambiguous visible copies after refresh do not choose another pane', () => {
    side('child'); side('child')
    const store = createAnnotationStore(() => 1, null)
    const annotation = store.add({ sessionId: 'child', sourceSurface: 'side', anchorKey: 'a:1', text: 'same phrase', anchorText: 'same phrase', occurrence: 0, note: '' })
    expect(resolveRange(annotation, new Map(), 'parent')).toBeNull()
  })

  it('clip limits include the side transcript and its own composer', () => {
    const a = side('child')
    a.view.getBoundingClientRect = () => rect(600, 60, 1000, 700)
    a.view.innerHTML = '<div style="overflow-y:auto"><div data-sidenote-message-key="a:1" data-sidenote-message-role="assistant"><div data-sidenote-quote-body>text</div></div></div><div data-sidenote-composer></div>'
    const transcript = a.view.firstElementChild as HTMLElement
    transcript.getBoundingClientRect = () => rect(600, 100, 1000, 600)
    const composer = a.view.lastElementChild as HTMLElement
    composer.getBoundingClientRect = () => rect(600, 580, 1000, 700)
    const body = a.view.querySelector<HTMLElement>('[data-sidenote-quote-body]')!
    expect(sourceClip({ body, anchor: body, view: a.view, sessionId: 'child', surface: 'side', streaming: false })).toEqual({ left: 600, top: 100, right: 1000, bottom: 580 })
  })
})
