/** @vitest-environment jsdom */
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import { registerUserContext, sentContextRule } from '../src/client/annotations/NativeUserContext.tsx'
import { buildProtocolBlock } from '../src/client/annotations/format.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const annotation = buildProtocolBlock([{ text: '引用原文\n第二行', note: '用户注解' }])
const reflow = '<reflow source="侧边 · 调查">\n<问>问题</问>\n<答>完整回答</答>\n</reflow>'
const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })

function mount(text: string, modern: boolean, key = 'user') {
  type Props = { node: { data: { content: readonly { type: string; text?: string }[] } } }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const renderers = new Map<string, ComponentType<any>>()
  let rule: typeof sentContextRule | undefined
  const offRule = vi.fn(() => { rule = undefined })
  function Original({ node }: Props) {
    const text = node.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const match = rule?.match(text, 0)
    const Renderer = match && renderers.get(match.id)
    return <div data-native-user-row>
      <div data-native-attachments>{node.data.content.filter(block => block.type !== 'text').map((block, index) => <span key={index}>{block.type}</span>)}</div>
      {text !== '' && <div className="native_bubble" data-native-bubble>{match && Renderer ? <>{createElement(Renderer, { node: match, interactive: true })}<span data-native-body>{text.slice(match.end)}</span></> : <span data-native-body>{text}</span>}</div>}
      <button data-native-copy>Copy</button>
    </div>
  }
  const entry = { component: Original as ComponentType<Props>, options: { key } }
  const ctx = {
    get: () => modern ? { userText: { register(value: typeof sentContextRule) { rule = value; return offRule } } } : {},
    inject: (_keys: unknown, callback: () => void) => { callback() },
    slots: {
      inject: (_name: string, callback: () => (() => void)) => { cleanup.push(callback()) },
      register: (options: { key: string }, renderer: ComponentType<any>) => { renderers.set(options.key, renderer); return () => { renderers.delete(options.key) } },
      entries: () => [entry],
      subscribe: () => () => {},
    },
  } as unknown as Context
  registerUserContext(ctx)
  const content = Object.freeze([Object.freeze({ type: 'image' }), Object.freeze({ type: 'text', text })] as const)
  const props = { node: { data: { content } } }
  act(() => { root.render(createElement(entry.component, props)) })
  cleanup.push(() => { act(() => { root.unmount() }); host.remove() })
  return { host, content, props, rerender: () => act(() => { root.render(createElement(entry.component, { ...props, node: { ...props.node } })) }) }
}

describe.each([true, false])('sent context inside the native user bubble (UserText=%s)', modern => {
  it.each(['user', 'steering'])('keeps the %s body, annotation and reflow together without changing durable content', key => {
    const wire = reflow + '\n\n' + annotation + '\n\nhi @原生引用'
    const { host, content, rerender } = mount(wire, modern, key)
    const bubble = host.querySelector('[data-native-bubble]')!
    expect(bubble.querySelector('[data-dsh-sidenote-bubble]')).not.toBeNull()
    expect(bubble.querySelector('[data-native-body]')?.textContent).toBe('hi @原生引用')
    expect(host.querySelector('[data-native-attachments]')?.textContent).toBe('image')
    expect(host.querySelector('[data-native-copy]')).not.toBeNull()
    expect(content[1]!.text).toBe(wire)
    const chips = bubble.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')
    expect(chips).toHaveLength(2)
    const panel = document.getElementById(chips[0]!.getAttribute('aria-controls')!)!
    expect(panel.hidden).toBe(true)
    act(() => { chips[0]!.click() })
    expect(panel.hidden).toBe(false)
    expect(panel.textContent).toContain('引用原文\n第二行')
    expect(panel.textContent).toContain('用户注解')
    rerender()
    expect(host.querySelectorAll('[data-dsh-sidenote-bubble]')).toHaveLength(1)
    expect(bubble.contains(host.querySelector('[data-dsh-sidenote-bubble]'))).toBe(true)
  })

  it('retains a native bubble when annotations are the entire user message', () => {
    const { host } = mount(annotation, modern)
    const bubble = host.querySelector('[data-native-bubble]')!
    expect(bubble).not.toBeNull()
    expect(bubble.querySelector('button[aria-expanded="false"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-dsh-sidenote-bubble]')).toHaveLength(1)
  })

  it('leaves ordinary messages and quoted protocol-looking body text alone', () => {
    const text = '解释下面的协议：\n' + annotation
    const { host } = mount(text, modern)
    expect(host.querySelector('[data-dsh-sidenote-bubble]')).toBeNull()
    expect(host.querySelector('[data-native-body]')?.textContent).toBe(text)
  })
})

it('matches only the protocol range after a progress snapshot', () => {
  const snapshot = '<mainline-progress-snapshot taken-at="2026-10-24 20:00">进展</mainline-progress-snapshot>\n\n'
  const text = snapshot + annotation + '\n\n正文'
  const node = sentContextRule.match(text, 0)!
  expect(node.start).toBe(snapshot.length)
  expect(text.slice(node.end)).toBe('正文')
  expect(sentContextRule.match(text, node.end)).toBeUndefined()
})
