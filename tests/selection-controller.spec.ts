/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSelectionController, previewSelection, resolveSelection, type SelectionController } from '../src/client/annotate/selection.ts'

const controllers: SelectionController[] = []
const rect = { left: 10, top: 100, width: 200, height: 20, right: 210, bottom: 120, x: 10, y: 100, toJSON() {} }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  document.body.innerHTML = '<div data-conversation-session="main"><div data-chat-flow-kind="assistant-step" data-chat-anchor-key="answer" data-chat-turn="1"><p id="before">repeated / </p><p id="quote">repeated</p></div></div>'
})
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function select(id = 'quote') {
  const node = document.getElementById(id)!.firstChild!
  const range = document.createRange()
  range.selectNodeContents(node)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  return range
}
function controller() {
  const value = createSelectionController(() => 'main')
  controllers.push(value)
  return value
}
function pointer(type: string, target: Element = document.body, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, button: 0, cancelable: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  target.dispatchEvent(event)
  return event
}

describe('native selection interaction', () => {
  it('leaves dragging untouched and publishes on release without a timer', () => {
    const value = controller()
    const readStyle = vi.spyOn(window, 'getComputedStyle')
    const down = pointer('pointerdown')
    select()
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(500)
    expect(down.defaultPrevented).toBe(false)
    expect(readStyle).not.toHaveBeenCalled()
    expect(value.getSnapshot().selection).toBeNull()
    pointer('pointerup')
    expect(value.getSnapshot().selection?.text).toBe('repeated')
    const released = value.getSnapshot()
    vi.advanceTimersByTime(500)
    expect(value.getSnapshot()).toBe(released)
  })

  it('does not recapture the release when selectionchange follows for the same range', () => {
    const value = controller()
    select()
    pointer('pointerup')
    const snapshot = value.getSnapshot()
    const readStyle = vi.spyOn(window, 'getComputedStyle')
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(500)
    expect(value.getSnapshot()).toBe(snapshot)
    expect(readStyle).not.toHaveBeenCalled()
  })

  it('replaces a pending touch/keyboard frame with the final released selection', () => {
    const value = controller()
    select('before')
    document.dispatchEvent(new Event('selectionchange'))
    select()
    pointer('pointerup')
    expect(value.getSnapshot().selection?.text).toBe('repeated')
    const released = value.getSnapshot()
    vi.advanceTimersByTime(500)
    expect(value.getSnapshot()).toBe(released)
  })

  it('coalesces keyboard and touch changes into one frame without a 200ms wait', () => {
    const value = controller()
    pointer('pointerdown', document.body, 'touch')
    select()
    const notify = vi.fn()
    value.subscribe(notify)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(16)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(value.getSnapshot().selection?.text).toBe('repeated')
    select('before')
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', shiftKey: true }))
    expect(value.getSnapshot().selection?.text).toBe('repeated / ')
  })

  it('keeps a toolbar click attached to its selection, and clears outside clicks and Escape', () => {
    const value = controller()
    select(); pointer('pointerup')
    const state = value.getSnapshot()
    const toolbar = document.createElement('div')
    toolbar.dataset.dshSidenote = ''
    toolbar.innerHTML = '<button>Annotate</button>'
    document.body.append(toolbar)
    pointer('pointerdown', toolbar.firstElementChild!)
    expect(value.getSnapshot()).toBe(state)
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }))
    expect(value.getSnapshot().selection).toBeNull()
    pointer('pointerup')
    pointer('pointerdown')
    expect(value.getSnapshot().selection).toBeNull()
  })

  it.each(['pointercancel', 'blur', 'dispose'])('cancels queued work on %s', event => {
    const value = controller()
    select()
    document.dispatchEvent(new Event('selectionchange'))
    if (event === 'dispose') value.dispose()
    else (event === 'blur' ? window : document).dispatchEvent(new Event(event))
    vi.advanceTimersByTime(500)
    expect(value.getSnapshot().selection).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('preview and committed quote separation', () => {
  it('does not inspect unselected formula trees until the annotation action', () => {
    const before = document.getElementById('before')!
    before.innerHTML = '<span>repeated / </span>' + '<span><span><span>formula</span></span></span>'.repeat(500)
    select()
    const readStyle = vi.spyOn(window, 'getComputedStyle')
    const preview = previewSelection('main')!
    expect(preview.text).toBe('repeated')
    expect(preview).not.toHaveProperty('occurrence')
    expect(readStyle.mock.calls.some(([element]) => before.contains(element))).toBe(false)
    expect(resolveSelection(preview)).toMatchObject({ text: 'repeated', occurrence: 1 })
    expect(readStyle.mock.calls.some(([element]) => before.contains(element))).toBe(true)
  })

  it.each(['replacement', 'hidden', 'streaming', 'session', 'message'])('refuses a stale quote after %s changes', change => {
    select()
    const preview = previewSelection('main')!
    const quote = document.getElementById('quote')!
    if (change === 'replacement') quote.textContent = 'another passage'
    if (change === 'hidden') quote.hidden = true
    if (change === 'streaming') quote.parentElement!.setAttribute('data-streaming', '')
    if (change === 'session') quote.closest<HTMLElement>('[data-conversation-session]')!.dataset.conversationSession = 'other'
    if (change === 'message') quote.parentElement!.dataset.chatAnchorKey = 'other'
    expect(resolveSelection(preview)).toBeNull()
  })
})
