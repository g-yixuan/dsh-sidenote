/**
 * MarkdownText labels 双形状兼容层（照抄 better-sidebar markdown-labels.tsx
 * 的已验证模式）：
 *
 * - DSH 0.1.1-rc.x：可选扁平 prop `codeLabels`（{ copyLabel, copiedLabel }）。
 * - DSH 0.1.2-alpha.1+：改为**必填嵌套** `labels: { code: { ... }, footnotes }`——
 *   只传旧 prop 时 fence 渲染抛 "Cannot read properties of undefined
 *   (reading 'code')"（BS 真机验证过的破坏）。
 *
 * 同一个 chrome 对象以两个 prop 名各传一份，两版宿主各取所需、互不认识
 * 的另一个被忽略。TS 构建期类型是旧代（无 labels prop），故整组 props
 * 需要一次 unknown 窄转（load-bearing cast）。
 *
 * chrome 对象跨渲染保持引用稳定（按文案内容记忆化）：MarkdownText 的
 * 流式缓存对 labels 身份敏感（dsh-sidebar-qa 的既有教训——每次渲染新
 * 对象会清缓存）。
 */
import type { ComponentProps } from 'react'
// type-only：值导入会把 katex CSS 拉进 node 测试环境（vitest 无法加载 .css）。
import type { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../locales.ts'

export interface MarkdownChrome {
  copyLabel: string
  copiedLabel: string
  code: { copyLabel: string; copiedLabel: string }
  footnotes: string
}

let cache: { copyLabel: string; copiedLabel: string; chrome: MarkdownChrome } | undefined

/** 当前语言的 chrome 对象（同语言复用同一引用）。 */
export function markdownChrome(): MarkdownChrome {
  const copyLabel = t('codeCopy')
  const copiedLabel = t('codeCopied')
  if (cache !== undefined && cache.copyLabel === copyLabel && cache.copiedLabel === copiedLabel) {
    return cache.chrome
  }
  const chrome: MarkdownChrome = { copyLabel, copiedLabel, code: { copyLabel, copiedLabel }, footnotes: '' }
  cache = { copyLabel, copiedLabel, chrome }
  return chrome
}

/** MarkdownText 整组 props（双 prop 名承载同一 chrome；text/streaming 透传）。 */
export function markdownTextProps(text: string, streaming?: boolean): ComponentProps<typeof MarkdownText> {
  const chrome = markdownChrome()
  return { text, streaming, codeLabels: chrome, labels: chrome } as unknown as ComponentProps<typeof MarkdownText>
}
