/**
 * MarkdownText 双形状 labels 兼容层单测：双 prop 名承载 + 嵌套 code 形状 +
 * chrome 引用稳定（流式缓存对 labels 身份敏感）。
 */
import { describe, expect, it } from 'vitest'
import { markdownChrome, markdownTextProps } from '../src/client/markdown.ts'

describe('markdownTextProps（0.1.1/0.1.2 双形状）', () => {
  it('codeLabels 与 labels 同参承载，嵌套 code 形状齐备', () => {
    const props = markdownTextProps('正文', false) as unknown as Record<string, unknown>
    const codeLabels = props.codeLabels as Record<string, unknown>
    const labels = props.labels as Record<string, unknown>
    expect(typeof codeLabels.copyLabel).toBe('string')
    expect(typeof codeLabels.copiedLabel).toBe('string')
    expect(labels.code).toEqual({
      copyLabel: codeLabels.copyLabel,
      copiedLabel: codeLabels.copiedLabel,
    })
    expect(labels).toHaveProperty('footnotes')
    expect(props.text).toBe('正文')
  })

  it('chrome 引用跨调用稳定（同语言）', () => {
    expect(markdownChrome()).toBe(markdownChrome())
  })
})
