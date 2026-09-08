/**
 * PendingCard 渲染冒烟（jsdom，primitives 内联进 vitest 管道）：
 * 审批卡答复回调 + 按钮态回退；提问卡整批提交门槛。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PendingCardList } from '../../src/client/sidechat/PendingCard.tsx'
import type { PendingItem } from '../../src/client/sidechat/pending.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderCards(items: readonly PendingItem[]) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(<PendingCardList items={items} />) })
  return host
}

function clickButton(host: HTMLElement, text: string): void {
  const btn = [...host.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(text))
  expect(btn, `按钮「${text}」未渲染`).toBeDefined()
  act(() => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('PendingCardList', () => {
  it('审批卡：点「允许一次」→ answer(allowed-once)；答复中按钮禁用', async () => {
    let resolveAnswer: (() => void) | undefined
    const answer = vi.fn(() => new Promise<void>((res) => { resolveAnswer = res }))
    const host = renderCards([{ kind: 'approval', key: 'a1', toolName: 'edit', reason: '改 src 外', answer }])
    expect(host.textContent).toContain('edit')
    expect(host.textContent).toContain('改 src 外')
    clickButton(host, 'Allow once')
    expect(answer).toHaveBeenCalledWith('allowed-once')
    // 在途：按钮禁用（竞答回退前的保护态）
    const btns = [...host.querySelectorAll('button')]
    expect(btns.every(b => b.disabled)).toBe(true)
    await act(async () => { resolveAnswer!() })
  })

  it('审批卡：answer 抛错（被主视图抢答）→ 按钮态回退可再点', async () => {
    const answer = vi.fn(async () => { throw new Error('already settled') })
    const host = renderCards([{ kind: 'approval', key: 'a2', toolName: 'bash', answer }])
    clickButton(host, 'Allow once')
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
    const btn = [...host.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('Allow once'))!
    expect(btn.disabled).toBe(false)
  })

  it('提问卡：未选项时提交禁用；选项+提交整批发出', async () => {
    const answer = vi.fn(async () => {})
    const cancel = vi.fn(async () => {})
    const host = renderCards([{
      kind: 'question',
      key: 'q1',
      planReview: false,
      questions: [{ id: 'q1', question: 'Which approach?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }],
      answer,
      cancel,
    }])
    const submit = [...host.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('Submit'))!
    expect(submit.disabled).toBe(true)
    clickButton(host, 'A')
    expect(submit.disabled).toBe(false)
    clickButton(host, 'Submit')
    expect(answer).toHaveBeenCalledWith([{ id: 'q1', selected: ['A'] }])
  })

  it('提问卡：自定义文本单独成答；取消走 cancel', async () => {
    const answer = vi.fn(async () => {})
    const cancel = vi.fn(async () => {})
    const host = renderCards([{
      kind: 'question',
      key: 'q2',
      planReview: true,
      questions: [{ id: 'q1', question: 'Plan ok?', options: [], multiSelect: false }],
      answer,
      cancel,
    }])
    const input = host.querySelector('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'looks fine')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickButton(host, 'Submit')
    expect(answer).toHaveBeenCalledWith([{ id: 'q1', selected: [], custom: 'looks fine' }])
  })
})
