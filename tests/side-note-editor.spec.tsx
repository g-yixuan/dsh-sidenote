// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SideChatNoteEditor } from '../src/client/annotate/overlay.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.replaceChildren() })

function mount(save: (note: string) => boolean = () => true) {
  const onSave = vi.fn(save)
  const onCancel = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (handler = onSave) => act(() => {
    root.render(<SideChatNoteEditor x={40} y={40} onSave={handler} onCancel={onCancel} />)
  })
  render()
  const input = host.querySelector('input')!
  const type = (text: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const outside = () => act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  const key = (key: string, options: KeyboardEventInit = {}) => act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }))
  })
  return { host, input, onSave, onCancel, render, type, outside, key, unmount: () => act(() => root.unmount()) }
}

describe('side-chat note editor', () => {
  it('outside click preserves the latest note exactly once', () => {
    const v = mount()
    v.type('刚输入的中文注解')
    v.outside(); v.outside(); v.key('Enter')
    expect(v.onSave).toHaveBeenCalledExactlyOnceWith('刚输入的中文注解')
    expect(v.onCancel).not.toHaveBeenCalled()
    v.unmount()
  })

  it('outside click saves an empty note; Escape explicitly cancels', () => {
    const empty = mount(); empty.outside()
    expect(empty.onSave).toHaveBeenCalledExactlyOnceWith('')
    empty.unmount()
    const v = mount(); v.type('放弃这条'); v.key('Escape')
    expect(v.onCancel).toHaveBeenCalledOnce()
    expect(v.onSave).not.toHaveBeenCalled()
    v.unmount()
  })

  it('failure retains content and does not retry on unrelated outside clicks', () => {
    const v = mount(() => false)
    v.type('失败也要保留'); v.outside(); v.outside()
    expect(v.input.value).toBe('失败也要保留')
    expect(v.host.textContent).toContain("Couldn't open")
    expect(v.onSave).toHaveBeenCalledOnce()
    expect(v.onCancel).not.toHaveBeenCalled()
    v.key('Enter')
    expect(v.onSave).toHaveBeenCalledTimes(2)
    v.unmount()
  })

  it('a throwing save retains the editor and allows explicit retry', () => {
    const v = mount(() => { throw new Error('unavailable target') })
    v.type('目标失效'); v.outside()
    expect(v.input.value).toBe('目标失效')
    expect(v.host.textContent).toContain("Couldn't open")
    const retry = vi.fn(() => true)
    v.render(retry); v.key('Enter'); v.outside()
    expect(retry).toHaveBeenCalledExactlyOnceWith('目标失效')
    v.unmount()
  })

  it('uses the current callback after a target change', () => {
    const v = mount()
    v.type('正确目标')
    const next = vi.fn(() => true)
    v.render(next); v.outside()
    expect(v.onSave).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledExactlyOnceWith('正确目标')
    v.unmount()
  })

  it('internal clicks and IME Enter do not submit; confirm does', () => {
    const v = mount()
    v.type('输入法注解')
    act(() => v.input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    v.key('Enter', { isComposing: true }); v.key('Enter', { keyCode: 229 })
    expect(v.onSave).not.toHaveBeenCalled()
    act(() => v.host.querySelector('button')!.click())
    expect(v.onSave).toHaveBeenCalledExactlyOnceWith('输入法注解')
    v.unmount()
  })
})
