/**
 * 划选注释编辑器的关闭语义（jsdom 挂载真实组件）：
 * - 新建态点外部 = 确认：这是最常见的一步——点「添加到对话」后直接去点输入框写问题。
 *   修复前这里走 onCancel，刚从 store 创建、还没确认的注释被整条删除，用户划选的
 *   引用（角标 / 原文高亮 / chip）一起消失；
 * - 新建态 Esc = 取消（显式放弃，语义不变）；
 * - 重开态点外部 = 取消（只关编辑器，已有注解不动）；
 * - 编辑器内部点击不触发任何关闭。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AnnotationEditor } from '../src/client/annotate/overlay.tsx'
import type { Annotation } from '../src/client/annotate/model.ts'

// React 18 act 环境标记（jsdom 下手渲需要）。
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.replaceChildren() })

function annotationWith(note: string): Annotation {
  return {
    id: 1,
    number: 1,
    sessionId: 's1',
    anchorKey: 'k1',
    text: '被划选的原文',
    anchorText: '被划选的原文',
    occurrence: 0,
    note,
    state: 'active',
    createdAt: 0,
  }
}

interface Mounted {
  readonly host: HTMLElement
  readonly onSave: ReturnType<typeof vi.fn>
  readonly onCancel: ReturnType<typeof vi.fn>
  readonly onDelete: ReturnType<typeof vi.fn>
  readonly unmount: () => void
}

function mountEditor(mode: 'new' | 'edit', note = ''): Mounted {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  const onDelete = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <AnnotationEditor
        annotation={annotationWith(note)}
        mode={mode}
        x={40}
        y={40}
        onSave={onSave}
        onDelete={onDelete}
        onCancel={onCancel}
      />,
    )
  })
  return {
    host,
    onSave,
    onCancel,
    onDelete,
    unmount: () => { act(() => { root.unmount() }) },
  }
}

/** 点编辑器外部：真实 mousedown，冒泡到 document 的捕获监听。 */
function clickOutside(): void {
  const outside = document.createElement('button')
  document.body.appendChild(outside)
  act(() => { outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  outside.remove()
}

/** 受控 input 输入：原生 value setter + input 事件（React onChange 的接通方式）。 */
function typeNote(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('AnnotationEditor 关闭语义', () => {
  it('新建态点外部 = 确认，并带上刚输入的注解（引用不再凭空消失）', () => {
    const view = mountEditor('new')
    const input = view.host.querySelector('input')
    expect(input).not.toBeNull()
    typeNote(input!, '这里有问题')
    clickOutside()
    expect(view.onCancel).not.toHaveBeenCalled()
    expect(view.onSave).toHaveBeenCalledTimes(1)
    expect(view.onSave).toHaveBeenCalledWith('这里有问题')
    view.unmount()
  })

  it('新建态点外部 = 确认空注解（用户没写注解，直接去写问题）', () => {
    const view = mountEditor('new')
    clickOutside()
    expect(view.onCancel).not.toHaveBeenCalled()
    expect(view.onSave).toHaveBeenCalledWith('')
    view.unmount()
  })

  it('新建态 Esc = 取消（显式放弃）', () => {
    const view = mountEditor('new')
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(view.onCancel).toHaveBeenCalledTimes(1)
    expect(view.onSave).not.toHaveBeenCalled()
    view.unmount()
  })

  it('编辑器内部点击不关闭（写注解时不被外点判定误伤）', () => {
    const view = mountEditor('new')
    const input = view.host.querySelector('input')!
    act(() => { input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(view.onSave).not.toHaveBeenCalled()
    expect(view.onCancel).not.toHaveBeenCalled()
    view.unmount()
  })

  it('重开态点外部 = 取消（只关编辑器，已有注解不受影响）', () => {
    const view = mountEditor('edit', '已有注解')
    clickOutside()
    expect(view.onCancel).toHaveBeenCalledTimes(1)
    expect(view.onSave).not.toHaveBeenCalled()
    view.unmount()
  })
})
