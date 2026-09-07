/**
 * chat/transcript.ts（L0 纯逻辑）单测：文本工具、节点折叠、消息流折叠。
 * 自 sidechat.spec.ts 迁入（WI-00 搬家：tests 镜像 src 结构）。
 */
import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '../../src/client/host/contracts.ts'
import {
  contentTextOf,
  nodeToMessage,
  transcriptOf,
  truncateText,
} from '../../src/client/chat/transcript.ts'

describe('truncateText', () => {
  it('未超限原样返回', () => {
    expect(truncateText('abc', 3)).toBe('abc')
  })
  it('超限截断并加省略号', () => {
    expect(truncateText('abcd', 3)).toBe('abc…')
  })
})

describe('contentTextOf', () => {
  it('text 块拼接、image 块占位、未知块忽略', () => {
    expect(contentTextOf([
      { type: 'text', text: '一' },
      { type: 'image' },
      { type: 'tool_use', id: 'x' },
      { type: 'text', text: '二' },
    ])).toBe('一\n[Image]\n二')
  })
  it('非数组/空输入返回空串', () => {
    expect(contentTextOf(undefined)).toBe('')
    expect(contentTextOf('text')).toBe('')
    expect(contentTextOf([])).toBe('')
  })
})

// ── 消息流折叠 ──────────────────────────────────────────────────────────────

describe('nodeToMessage', () => {
  it('user 节点 → user 行', () => {
    expect(nodeToMessage({ kind: 'user', seq: 1, content: [{ type: 'text', text: '问题' }] })).toEqual({
      key: 'u:1', role: 'user', text: '问题',
    })
  })
  it('steering 节点 → user 行', () => {
    expect(nodeToMessage({ kind: 'steering', seq: 2, content: [{ type: 'text', text: '插队' }] })?.role).toBe('user')
  })
  it('assistant 节点：文本 + 思考 + 打断标记', () => {
    expect(nodeToMessage({
      kind: 'assistant',
      seq: 3,
      interrupted: true,
      blocks: [
        { kind: 'reasoning', text: '想想' },
        { kind: 'text', text: '回答' },
      ],
    })).toEqual({ key: 'a:3', role: 'assistant', text: '回答', reasoning: '想想', interrupted: true })
  })
  it('assistant 节点：纯工具调用头不渲染（结果节点承载卡片）', () => {
    expect(nodeToMessage({ kind: 'assistant', seq: 4, blocks: [{ kind: 'tool-call', callId: 'c', name: 'Bash', argsRaw: '{}' }] })).toBeNull()
  })
  it('tool-result 节点 → 工具卡片（带名/失败标记/正文截断）', () => {
    const long = 'x'.repeat(5000)
    const message = nodeToMessage({
      kind: 'tool-result',
      seq: 5,
      callId: 'c1',
      call: { name: 'Bash' },
      isError: true,
      content: [{ type: 'text', text: long }],
    })
    expect(message?.role).toBe('tool')
    expect(message?.toolName).toBe('Bash')
    expect(message?.isError).toBe(true)
    expect(message?.text.length).toBe(4001) // 4000 + …
  })
  it('tool-result 缺 call 头时回退 callId', () => {
    expect(nodeToMessage({ kind: 'tool-result', seq: 6, callId: 'c9', call: null, content: [] })?.toolName).toBe('c9')
  })
  it('turn-error → error 行', () => {
    expect(nodeToMessage({ kind: 'turn-error', seq: 7, message: '炸了' })).toEqual({ key: 'e:7', role: 'error', text: '炸了' })
  })
  it('model-retry：已取消不渲染，其余为提示行', () => {
    expect(nodeToMessage({ kind: 'model-retry', seq: 8, retryState: 'cancelled' })).toBeNull()
    expect(nodeToMessage({ kind: 'model-retry', seq: 8, retryState: 'scheduled' })?.role).toBe('notice')
    expect(nodeToMessage({ kind: 'model-retry', seq: 8, retryState: 'started' })?.text).toContain('retry')
  })
  it('turn-max-tokens / command / compaction → notice 行', () => {
    expect(nodeToMessage({ kind: 'turn-max-tokens', seq: 9 })?.role).toBe('notice')
    expect(nodeToMessage({ kind: 'command', seq: 10, name: 'goal', args: ' x' })?.text).toBe('Run command /goal x')
    expect(nodeToMessage({ kind: 'compaction', seq: 11 })?.text).toContain('compacted')
  })
  it('context / unknown / 畸形节点不渲染', () => {
    expect(nodeToMessage({ kind: 'context', seq: 12 })).toBeNull()
    expect(nodeToMessage({ kind: 'unknown', seq: 13 })).toBeNull()
    expect(nodeToMessage(undefined)).toBeNull()
    expect(nodeToMessage('boom')).toBeNull()
  })
})

describe('transcriptOf', () => {
  it('空快照/未绑定 → 空列表', () => {
    expect(transcriptOf(undefined)).toEqual([])
    expect(transcriptOf(null)).toEqual([])
    expect(transcriptOf({} as unknown as ConversationSnapshot)).toEqual([])
  })
  it('节点 + 在途工具 + 流式部分依序折叠', () => {
    const snapshot = {
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: '问' }] },
        { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '答' }] },
      ],
      runningCalls: [{ callId: 'c1', name: 'Bash' }],
      partial: { blocks: [{ kind: 'text', text: '正在' }] },
    } as unknown as ConversationSnapshot
    expect(transcriptOf(snapshot)).toEqual([
      { key: 'u:1', role: 'user', text: '问' },
      { key: 'a:2', role: 'assistant', text: '答' },
      { key: 'rc:c1', role: 'tool', toolName: 'Bash', text: '', streaming: true },
      { key: 'partial', role: 'assistant', text: '正在', streaming: true },
    ])
  })
  it('partial 只有工具调用头时不渲染空泡', () => {
    const snapshot = {
      nodes: [],
      partial: { blocks: [{ kind: 'tool-call', callId: 'c', name: 'Read', argsRaw: '' }] },
    } as unknown as ConversationSnapshot
    expect(transcriptOf(snapshot)).toEqual([])
  })
  it('空 partial 渲染流式占位（正在输出）', () => {
    const snapshot = { nodes: [], partial: { blocks: [] } } as unknown as ConversationSnapshot
    expect(transcriptOf(snapshot)).toEqual([{ key: 'partial', role: 'assistant', text: '', streaming: true }])
  })
})
