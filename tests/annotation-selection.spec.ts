/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { captureSelection } from '../src/client/annotate/selection.ts'
import { resolveRanges, type CachedRange } from '../src/client/annotate/anchor.ts'
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

function select(start: Node, startOffset = 0, end = start, endOffset = end.textContent!.length) {
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

  it('cross-pane, streaming and controls cannot become quotes', () => {
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

  it('rejects blank, non-assistant, legacy assistant and session-less text', () => {
    for (const [kind, text] of [['assistant-step', '  '], ['user', 'question'], ['assistant', 'legacy reply']]) {
      document.body.innerHTML = `<div data-conversation-session="main"><div data-chat-flow-kind="${kind}">${text}</div></div>`
      select(document.querySelector('[data-chat-flow-kind]')!.firstChild!)
      expect(captureSelection('main')).toBeNull()
    }
    document.body.innerHTML = '<div data-chat-flow-kind="assistant-step">reply without a session</div>'
    select(document.body.firstChild!.firstChild!)
    expect(captureSelection('')).toBeNull()
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

  it('rejects both standalone reasoning and mixed reasoning/reply selections', () => {
    const a = side('child')
    a.body.innerHTML = '<div data-variant="think"><p>native reasoning</p></div><p>final answer</p>'
    select(a.body.querySelector('[data-variant="think"] p')!.firstChild!)
    expect(captureSelection('parent')).toBeNull()
    select(a.body, 0, a.body, a.body.childNodes.length)
    expect(captureSelection('parent')).toBeNull()
    select(a.body.querySelector(':scope > p')!.firstChild!)
    expect(captureSelection('parent')?.text).toBe('final answer')
  })

  it('reanchors only within the recorded session/surface/message, and never guesses a missing occurrence', () => {
    side('wrong-child')
    const a = side('right-child', 'a:1', 'same phrase / same phrase')
    const store = createAnnotationStore(() => 1, null)
    const annotation = store.add({ sessionId: 'right-child', sourceSessionId: 'right-child', sourceSurface: 'side', anchorKey: 'a:1', text: 'same phrase', anchorText: 'same phrase', occurrence: 1, note: '' })
    const cache = new Map<number, CachedRange>()
    const restored = resolveRanges(annotation, cache, 'parent')![0]!
    expect(restored.startContainer).toBe(a.body.firstChild)
    expect(restored.startOffset).toBe(14)
    a.body.textContent = 'same phrase'
    expect(resolveRanges(annotation, cache, 'parent')).toBeNull()
    expect(store.get(annotation.id)?.state).toBe('active')
  })

  it('ambiguous visible copies after refresh do not choose another pane', () => {
    side('child'); side('child')
    const store = createAnnotationStore(() => 1, null)
    const annotation = store.add({ sessionId: 'child', sourceSurface: 'side', anchorKey: 'a:1', text: 'same phrase', anchorText: 'same phrase', occurrence: 0, note: '' })
    expect(resolveRanges(annotation, new Map(), 'parent')).toBeNull()
  })

  function mainReplies() {
    document.body.innerHTML = `<div data-conversation-session="main">
      <div data-chat-flow-kind="assistant-step" data-chat-group-part="response" data-chat-anchor-key="a:1" data-chat-turn="1"><p>First progress reply.</p></div>
      <div data-chat-flow-kind="tool-call" hidden><button>Read file</button><pre>private tool output</pre></div>
      <div data-chat-flow-kind="assistant-step" data-chat-group-part="reasoning" data-chat-anchor-key="reason:2" data-chat-turn="1" hidden><div data-variant="think">private reasoning</div></div>
      <div data-chat-flow-kind="assistant-step" data-chat-group-part="response" data-chat-anchor-key="a:3" data-chat-turn="1"><p>Final visible reply.</p></div>
    </div>`
    const replies = [...document.querySelectorAll<HTMLElement>('[data-chat-group-part="response"]')]
    for (const reply of replies) reply.getClientRects = () => [rect()] as unknown as DOMRectList
    const selectBoth = () => select(replies[0]!.querySelector('p')!.firstChild!, 0, replies[1]!.querySelector('p')!.firstChild!)
    return { replies, selectBoth }
  }

  it('admits completed progress and cross-reply text in one Turn, excluding hidden process rows', () => {
    const { replies, selectBoth } = mainReplies()
    select(replies[0]!.querySelector('p')!.firstChild!)
    expect(captureSelection('main')?.text).toBe('First progress reply.')
    selectBoth()
    const captured = captureSelection('main')!
    expect(captured.text).toBe('First progress reply.\n\nFinal visible reply.')
    expect(captured.anchors?.map(anchor => anchor.anchorKey)).toEqual(['a:1', 'a:3'])
    expect(captured.ranges.map(range => range.toString())).toEqual(['First progress reply.', 'Final visible reply.'])
  })

  it('rejects visible tool/reasoning content anywhere inside a selection with reply endpoints', () => {
    const { selectBoth } = mainReplies()
    selectBoth()
    const tool = document.querySelector<HTMLElement>('[data-chat-flow-kind="tool-call"]')!
    tool.hidden = false
    expect(captureSelection('main')).toBeNull()
    tool.hidden = true
    const reasoning = document.querySelector<HTMLElement>('[data-chat-group-part="reasoning"]')!
    reasoning.hidden = false
    expect(captureSelection('main')).toBeNull()
    reasoning.hidden = true
    expect(captureSelection('main')).not.toBeNull()
  })

  it('ignores CSS-hidden process content, but rejects other Turns and intervening user text', () => {
    const { replies, selectBoth } = mainReplies()
    const tool = document.querySelector<HTMLElement>('[data-chat-flow-kind="tool-call"]')!
    tool.hidden = false
    tool.style.display = 'none'
    selectBoth()
    expect(captureSelection('main')).not.toBeNull()
    replies[1]!.dataset.chatTurn = '2'
    expect(captureSelection('main')).toBeNull()
    replies[1]!.dataset.chatTurn = '1'
    tool.outerHTML = '<div data-chat-flow-kind="user">another question</div>'
    expect(captureSelection('main')).toBeNull()
  })

  it('rejects a streaming reply in the middle without blocking earlier settled replies', () => {
    const { replies, selectBoth } = mainReplies()
    replies[0]!.insertAdjacentHTML('afterend', '<div data-chat-flow-kind="assistant-step" data-chat-anchor-key="a:2" data-chat-turn="1"><p data-streaming>still growing</p></div>')
    selectBoth()
    expect(captureSelection('main')).toBeNull()
    select(replies[0]!.querySelector('p')!.firstChild!)
    expect(captureSelection('main')?.text).toBe('First progress reply.')
  })

  it('uses the same Turn boundary for explicit side and inherited reply bodies', () => {
    const a = side('child', 'a:1', 'first side reply')
    a.body.dataset.sidenoteTurn = 'history:3'
    a.view.insertAdjacentHTML('beforeend', '<div data-sidenote-quote-body data-sidenote-message-role="assistant" data-sidenote-message-key="a:2" data-sidenote-turn="history:3">second side reply</div>')
    const b = a.view.lastElementChild as HTMLElement
    select(a.body.firstChild!, 0, b.firstChild!)
    expect(captureSelection('parent')).toMatchObject({ sessionId: 'child', source: { surface: 'side' }, anchors: [{ anchorKey: 'a:1' }, { anchorKey: 'a:2' }] })
    b.dataset.sidenoteTurn = '3'
    expect(captureSelection('parent')).toBeNull()
  })

  it('retains separate cross-reply anchors after hydration, rebuild, folding and process expansion', () => {
    const { selectBoth } = mainReplies()
    selectBoth()
    const captured = captureSelection('main')!
    const data = new Map<string, string>()
    const storage = { get length() { return data.size }, key: (index: number) => [...data.keys()][index] ?? null,
      getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) },
      removeItem: (key: string) => { data.delete(key) } }
    const store = createAnnotationStore(() => 1, storage)
    store.add({ sessionId: 'main', anchorKey: captured.anchorKey, anchorText: captured.anchorText,
      occurrence: captured.occurrence, anchors: captured.anchors, text: captured.text, note: '' })
    const revived = createAnnotationStore(() => 2, storage).list('main')[0]!
    expect(revived.anchors).toEqual(captured.anchors)
    const { replies } = mainReplies()
    document.querySelector<HTMLElement>('[data-chat-flow-kind="tool-call"]')!.hidden = false
    const cache = new Map<number, CachedRange>()
    expect(resolveRanges(revived, cache, 'main')?.map(range => range.toString())).toEqual(['First progress reply.', 'Final visible reply.'])
    replies[0]!.hidden = true
    expect(resolveRanges(revived, cache, 'main')).toBeNull()
    expect(revived.text).toBe(captured.text)
    replies[0]!.hidden = false
    expect(resolveRanges(revived, cache, 'main')).toHaveLength(2)
    replies[1]!.textContent = 'different answer'
    expect(resolveRanges(revived, cache, 'main')).toBeNull()
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
