import { elementOf, mainMessageOf, mainAnchorBodies, nativeAssistantBodies, MAIN_ASSISTANT, NON_QUOTE, PROCESS_UI, quoteNodeVisible, quoteClipOf, focusMainComposer, focusSideComposer } from '../host/dom.ts'

export interface QuoteSource {
  body: HTMLElement
  anchor: HTMLElement
  view: HTMLElement
  sessionId: string
  surface: 'main' | 'side'
  streaming: boolean
  key?: string
  turn?: string
}

/** Explicit side bodies are the sole exception to the legacy sidebar exclusion. */
export function quoteSourceOf(node: Node, currentSessionId: string): QuoteSource | null {
  const element = elementOf(node)
  if (!element || element.closest(`${NON_QUOTE}, ${PROCESS_UI}`) !== null) return null
  const body = element?.closest<HTMLElement>('[data-sidenote-quote-body]')
  if (body !== undefined && body !== null) {
    const anchor = body.closest<HTMLElement>('[data-sidenote-message-key][data-sidenote-message-role="assistant"]')
    const view = body.closest<HTMLElement>('[data-sidenote-chat-session]')
    const sessionId = view?.dataset.sidenoteChatSession
    if (!sessionId || anchor === null || view === null) return null
    return { body, anchor, view, sessionId, surface: 'side', key: anchor.dataset.sidenoteMessageKey,
      turn: body.dataset.sidenoteTurn ?? body.closest<HTMLElement>('[data-chat-turn]')?.dataset.chatTurn,
      streaming: body.dataset.sidenoteStreaming === 'true' }
  }
  const native = mainMessageOf(node, currentSessionId)
  const side = element?.closest<HTMLElement>('[data-sidenote-chat-session]')
  if (native && side && native.sessionId === side.dataset.sidenoteChatSession) return { ...native, view: side, surface: 'side' }
  if (element?.closest('[data-dsh-better-sidebar], [data-dsh-sidenote], [data-sidenote-chat-session]') !== null) return null
  return native
}

export function sourceKey(source: QuoteSource): string | undefined {
  return source.key
}

export function sourceBodies(sessionId: string, surface: 'main' | 'side', anchorKey: string, currentSessionId: string): HTMLElement[] {
  const bodies = surface === 'main' ? mainAnchorBodies(sessionId, anchorKey, currentSessionId)
    : [...document.querySelectorAll<HTMLElement>('[data-sidenote-quote-body]'), ...nativeAssistantBodies().filter(body => !body.querySelector('[data-sidenote-quote-body]'))]
  return bodies.filter(body => {
    const source = quoteSourceOf(body, currentSessionId)
    return source?.surface === surface && source.sessionId === sessionId && sourceKey(source) === anchorKey
  })
}

/** Visit selected text without descending into unselected sibling subtrees. */
function* rangeTextNodes(range: Range): Generator<Text> {
  const root = range.commonAncestorContainer
  if (root.nodeType === Node.TEXT_NODE) { yield root as Text; return }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT
      return node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as Text
}

/** Admit the complete visible selection, never silently drop process content. */
export function quoteSourcesOfRange(range: Range, currentSessionId: string): QuoteSource[] | null {
  const sources: QuoteSource[] = []
  const seen = new Set<HTMLElement>()
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const node of rangeTextNodes(range)) {
    if (!quoteNodeVisible(node, styles)) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.textContent!.length
    if (node.textContent!.slice(start, end).trim() === '') continue
    const element = elementOf(node)!
    if (element.closest(PROCESS_UI)) return null
    if (element.closest(NON_QUOTE)) {
      // Code copy/language controls inside a reply keep their existing exclusion.
      const body = element.closest(`[data-sidenote-quote-body], ${MAIN_ASSISTANT}`)
      if (body && quoteSourceOf(body, currentSessionId)) continue
      return null
    }
    const source = quoteSourceOf(node, currentSessionId)
    if (!source || source.streaming) return null
    const first = sources[0]
    if (first && (source.view !== first.view || source.sessionId !== first.sessionId || source.surface !== first.surface)) return null
    if (seen.has(source.body)) continue
    if (first && (!first.turn || source.turn !== first.turn || !first.key || !source.key)) return null
    sources.push(source)
    seen.add(source.body)
  }
  return sources.length ? sources : null
}

/** Trim each stored fragment to the actual selected text, excluding surrounding UI. */
export function quoteRangeOf(body: HTMLElement, selection: Range): Range | null {
  const nodes = quoteTextNodes(body, selection).filter(node => selection.intersectsNode(node)
    && (node !== selection.startContainer || selection.startOffset < node.length)
    && (node !== selection.endContainer || selection.endOffset > 0))
  const first = nodes[0], last = nodes.at(-1)
  if (!first || !last) return null
  const range = document.createRange()
  range.setStart(first, first === selection.startContainer ? selection.startOffset : 0)
  range.setEnd(last, last === selection.endContainer ? selection.endOffset : last.length)
  return range
}

/** The same text-node projection is used at capture and when rebuilding anchors.
 * Browser selections contain block newlines; anchor offsets deliberately do not. */
export function quoteTextNodes(body: HTMLElement, range?: Range): Text[] {
  function* allNodes(): Generator<Text> {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as Text
  }
  const nodes: Text[] = []
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const node of range ? rangeTextNodes(range) : allNodes()) {
    if (!body.contains(node) || node.parentElement?.closest(`${NON_QUOTE}, ${PROCESS_UI}`) !== null || !quoteNodeVisible(node, styles)) continue
    if (node.parentElement !== null && styles.get(node.parentElement)?.userSelect === 'none') continue
    nodes.push(node)
  }
  return nodes
}

export function projectedRangeText(body: HTMLElement, range: Range): string {
  return quoteTextNodes(body, range).map(node => {
    if (!range.intersectsNode(node)) return ''
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    return node.data.slice(start, end)
  }).join('')
}

export function selectedQuoteText(range: Range, browserText: string, anchorText: string): string {
  if (browserText.replace(/\s/g, '') === anchorText.replace(/\s/g, '')) return browserText
  const fragment = range.cloneContents()
  for (const element of fragment.querySelectorAll(`${NON_QUOTE}, ${PROCESS_UI}, [hidden], [data-turn-process-hidden], [data-turn-process-inline]`)) element.remove()
  const textOf = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node instanceof Element && node.tagName === 'BR') return '\n'
    const text = [...node.childNodes].map(textOf).join('')
    return node instanceof Element && /^(P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(node.tagName) ? text + '\n' : text
  }
  return textOf(fragment).trimEnd()
}

export function sourceClip(source: QuoteSource) { return quoteClipOf(source.body, source.view) }

export function focusSourceComposer(source: QuoteSource): void {
  if (source.surface === 'main') focusMainComposer(source.view)
  else focusSideComposer(source.view)
}
