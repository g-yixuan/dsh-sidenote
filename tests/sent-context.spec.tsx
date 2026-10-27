/** @vitest-environment jsdom */
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import { ContextTextNode, LegacyPendingContexts, injectedReflowPrefix, registerUserContext, sentContextRule } from '../src/client/annotations/NativeUserContext.tsx'
import { buildProtocolBlock } from '../src/client/annotations/format.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const annotation = buildProtocolBlock([{ text: '引用原文\n第二行', note: '用户注解' }])
const reflow = '<reflow source="侧边 · 调查">\n<问>问题</问>\n<答>完整回答</答>\n</reflow>'
const cleanup: (() => void)[] = []
beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
  return (this === document.body ? { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } : { left: 100, top: 250, right: 300, bottom: 280, width: 200, height: 30 }) as DOMRect
}) })
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.restoreAllMocks() })

function mount(text: string, modern: boolean, key = 'user', injected = '', imageOnly = false) {
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
    effect: () => {}, // Legacy pending DOM projection is exercised separately below.
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
  const content: readonly { readonly type: string; readonly text?: string }[] = Object.freeze([Object.freeze({ type: 'image' }), ...(imageOnly ? [] : [Object.freeze({ type: 'text', text })])])
  const nodes = [...(injected ? [{ kind: 'context', seq: 9, source: { kind: 'dsh-sidenote' }, content: [{ type: 'text', text: injected }] }] : []), { kind: 'user', seq: 10 }]
  const props = { node: { data: { seq: 10, content } }, useChat: (select: any) => select({ legacy: { nodes } }) }
  act(() => { root.render(createElement(entry.component, props)) })
  cleanup.push(() => { act(() => { root.unmount() }); host.remove() })
  return { host, content, props, rerender: () => act(() => { root.render(createElement(entry.component, { ...props, node: { ...props.node } })) }) }
}

describe.each([true, false])('sent context inside the native user bubble (UserText=%s)', modern => {
  it('keeps injected context visible beside an image-only input without changing its attachments', () => {
    const { host, content } = mount('', modern, 'user', reflow, true)
    expect(host.querySelector('[data-native-bubble] [data-dsh-sidenote-bubble]')).not.toBeNull()
    expect(host.querySelector('[data-native-attachments]')?.textContent).toBe('image')
    expect(content).toEqual([{ type: 'image' }])
  })
  it('shows real injected reflows in their owning bubble without adding them to the durable body', () => {
    const { host, content, rerender } = mount('这是一个侧边回流测试', modern, 'user', '以下是用户从侧边对话带回的结论（参考上下文）：\n\n' + reflow)
    const bubble = host.querySelector('[data-native-bubble]')!
    expect(bubble.querySelector('[data-dsh-sidenote-bubble]')).not.toBeNull()
    expect(bubble.querySelector('[data-native-body]')?.textContent).toBe('这是一个侧边回流测试')
    act(() => { bubble.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click() })
    expect(document.querySelector('[data-sidenote-sent-preview]')?.textContent).toContain('完整回答')
    expect(bubble.textContent).not.toContain('完整回答')
    expect(content[1]!.text).toBe('这是一个侧边回流测试')
    rerender()
    expect(bubble.querySelectorAll('[data-dsh-sidenote-bubble]')).toHaveLength(1)
  })
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
    expect(document.getElementById(chips[0]!.getAttribute('aria-controls')!)).toBeNull()
    act(() => { chips[0]!.click() })
    const panel = document.getElementById(chips[0]!.getAttribute('aria-controls')!)!
    expect(panel).not.toBeNull()
    expect(bubble.contains(panel)).toBe(false)
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

it('does not attach another producer or cross an intervening response/input', () => {
  const context = { kind: 'context', seq: 1, source: { kind: 'dsh-sidenote' }, content: [{ type: 'text', text: reflow }] }
  expect(injectedReflowPrefix([context, { kind: 'user', seq: 2 }, { kind: 'user', seq: 3 }], 3)).toBe('')
  expect(injectedReflowPrefix([context, { kind: 'assistant', seq: 2 }, { kind: 'user', seq: 3 }], 3)).toBe('')
  expect(injectedReflowPrefix([{ ...context, source: { kind: 'another-plugin' } }, { kind: 'user', seq: 2 }], 2)).toBe('')
})

it('matches only the protocol range after a progress snapshot', () => {
  const snapshot = '<mainline-progress-snapshot taken-at="2026-10-24 20:00">进展</mainline-progress-snapshot>\n\n'
  const text = snapshot + annotation + '\n\n正文'
  const node = sentContextRule.match(text, 0)!
  expect(node.start).toBe(snapshot.length)
  expect(text.slice(node.end)).toBe('正文')
  expect(sentContextRule.match(text, node.end)).toBeUndefined()
})

it.each(['data-pending-steering', 'data-submission-echo', 'data-queue-dock', 'inert'])('enables read-only previews only on message surfaces: %s', surface => {
  const host = document.createElement('div')
  if (surface !== 'inert') host.setAttribute(surface, '')
  document.body.append(host)
  const root = createRoot(host)
  act(() => { root.render(<ContextTextNode node={{ data: sentContextRule.match(reflow, 0)!.data }} interactive={false} />) })
  const button = host.querySelector('button')
  expect(button !== null).toBe(surface !== 'inert')
  if (button) {
    act(() => { button.click() })
    expect(document.querySelector('[data-sidenote-sent-preview]')?.textContent).toContain('完整回答')
  }
  cleanup.push(() => { act(() => { root.unmount() }); host.remove() })
})

it('keeps previews inert inside another interactive control even in a queue', () => {
  const host = document.createElement('div')
  host.dataset.queueDock = ''
  const parent = document.createElement('button')
  host.append(parent); document.body.append(host)
  const root = createRoot(parent)
  act(() => { root.render(<ContextTextNode node={{ data: sentContextRule.match(reflow, 0)!.data }} interactive={false} />) })
  expect(parent.querySelector('button')).toBeNull()
  cleanup.push(() => { act(() => { root.unmount() }); host.remove() })
})

it.each(['data-pending-steering', 'data-submission-echo'])('projects legacy %s without replacing native children and restores them on cleanup', async surface => {
  const host = document.createElement('div')
  host.setAttribute(surface, '')
  const bubble = document.createElement('div')
  bubble.className = 'native_bubble'
  const wire = reflow + '\n\n' + annotation + '\n\n正文 '
  const text = document.createTextNode(wire)
  const nativeReference = document.createElement('span')
  nativeReference.textContent = '@原生引用'
  bubble.append(text, nativeReference); host.append(bubble); document.body.append(host)
  const root = createRoot(document.createElement('div'))
  act(() => { root.render(<LegacyPendingContexts />) })
  expect(bubble.querySelectorAll('[data-dsh-sidenote-bubble] button')).toHaveLength(2)
  expect(text.data).toBe('正文 ')
  expect(bubble.contains(nativeReference)).toBe(true)
  act(() => { bubble.querySelector<HTMLButtonElement>('button')!.click() })
  expect(document.querySelector('[data-sidenote-sent-preview]')?.textContent).toContain('引用原文')
  await act(async () => {
    text.data = reflow + '\n\n修改后的正文 '
    await new Promise(resolve => setTimeout(resolve, 40))
  })
  expect(bubble.querySelectorAll('[data-dsh-sidenote-bubble] button')).toHaveLength(1)
  expect(text.data).toBe('修改后的正文 ')
  act(() => { root.unmount() })
  expect(text.data).toBe(reflow + '\n\n修改后的正文 ')
  expect(bubble.querySelector('[data-sidenote-pending-seat]')).toBeNull()
  host.remove()
})

it('reads legacy queue details from full content instead of its flattened, truncated preview', () => {
  const host = document.createElement('div')
  host.dataset.queueDock = ''
  const row = document.createElement('li'), preview = document.createElement('span')
  preview.className = 'native_preview'
  const wire = reflow + '\n\n' + annotation + '\n\n正文 @引用'
  const truncated = wire.replace(/\s+/g, ' ').slice(0, 60) + '…'
  preview.textContent = truncated; row.append(preview); host.append(row); document.body.append(host)
  const root = createRoot(document.createElement('div'))
  act(() => { root.render(<LegacyPendingContexts queue={{ root: host, texts: [wire] }} />) })
  expect(preview.textContent).toContain('正文 @引用')
  expect(preview.textContent).not.toContain('<reflow')
  const chips = preview.querySelectorAll<HTMLButtonElement>('button')
  expect(chips).toHaveLength(2)
  act(() => { chips[1]!.click() })
  expect(document.querySelector('[data-sidenote-sent-preview]')?.textContent).toContain('完整回答')
  act(() => { root.unmount() })
  expect(preview.textContent).toBe(truncated)
  host.remove()
})
