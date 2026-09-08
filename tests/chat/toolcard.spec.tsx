/**
 * ToolCard 渲染冒烟（jsdom 客户端渲染，primitives 内联进 vitest 管道）。
 * 目的：拿到宿主 prod React 只给错误码（#310 类）的真实错误文本；
 * 顺便把卡片展开交互钉成回归（默认折叠 → 点击展开）。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ToolCard } from '../../src/client/chat/ToolCard.tsx'
import { createFoldStore } from '../../src/client/chat/viewState.ts'
import { cardModelOf } from '../../src/client/chat/cards.ts'

// React 18 act 环境标记（jsdom 下手渲需要）。
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderCard(model: ReturnType<typeof cardModelOf>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<ToolCard model={model} rowKey="k1" fold={createFoldStore()} />)
  })
  return host
}

describe('ToolCard render smoke（jsdom）', () => {
  it('terminal 卡（种子 bash）默认折叠 + 点击展开出输出', () => {
    const model = cardModelOf({
      toolName: 'bash',
      callView: { card: 'terminal', title: 'ls -1', description: 'List files' },
      resultView: { card: 'terminal', output: 'README.md\npackage.json', exitCode: 0 },
    })
    const host = renderCard(model)
    // 折叠态：标题 = 人话描述（「Bash · List files」），命令原文不露面。
    expect(host.textContent).toContain('Bash · List files')
    expect(host.textContent).not.toContain('ls -1')
    expect(host.textContent).not.toContain('package.json')
    // DisclosureRow 的行容器（data-disclosure-row + expandOnRowClick）。
    const row = host.querySelector('[data-disclosure-row]')!
    expect(row, 'DisclosureRow 行未渲染').not.toBeNull()
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 展开态：命令原文（TerminalBlock command）+ 输出都在。
    expect(host.textContent).toContain('ls -1')
    expect(host.textContent).toContain('package.json')
  })

  it('read 卡（种子 read）', () => {
    const model = cardModelOf({
      toolName: 'read',
      callView: { card: 'generic', title: 'README.md', kind: 'read' },
      resultView: { card: 'read', path: 'README.md', offset: 1, lines: [{ number: 1, text: '# x' }], totalLines: 3, lang: 'md' },
    })
    const host = renderCard(model)
    expect(host.textContent).toContain('README.md')
  })

  it('generic 卡 rawInput 对象（JsonTree 路径）', () => {
    const model = cardModelOf({
      toolName: 'todo',
      callView: { card: 'generic', title: '计划', rawInput: { a: 1 } },
      resultView: null,
    })
    expect(() => renderCard(model)).not.toThrow()
  })

  it('generic 卡空体（无 bodyText/rawInput）', () => {
    const model = cardModelOf({ toolName: 'x', callView: null, resultView: null })
    expect(() => renderCard(model)).not.toThrow()
  })
})
