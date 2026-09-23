/**
 * 主线进展快照（Delivery_04 / WI-02/03）单测：当前 turn 内容提取、协议块
 * 序列化、呈现层的块拆分（气泡只留正文、快照提升到继承卡）。
 */
import { describe, expect, it } from 'vitest'
import { serializeSnapshot, snapshotEntriesOf, SNAPSHOT_BLOCK_MARK } from '../src/client/sidechat/snapshot.ts'
import { splitSnapshotPrefix } from '../src/client/sidechat/rows.tsx'

const userNode = (text: string) => ({ kind: 'user', seq: 1, content: [{ type: 'text', text }] })
const assistantNode = (reply: string, thinking?: string) => ({
  kind: 'assistant', seq: 2,
  blocks: [
    ...(thinking !== undefined ? [{ kind: 'reasoning', text: thinking }] : []),
    ...(reply !== '' ? [{ kind: 'text', text: reply }] : []),
  ],
})
const toolNode = (name: string, args: string, result: string) => ({
  kind: 'tool-result', seq: 3,
  call: { name, argsRaw: args },
  content: [{ type: 'text', text: result }],
})

describe('snapshotEntriesOf（当前 turn 内容提取）', () => {
  it('从最后一个 user 节点取起：思考/正文/工具各成拍', () => {
    const nodes = [
      userNode('旧轮的问题'),
      assistantNode('旧轮的回答'),
      userNode('主线在飞的任务'),
      assistantNode('', '正在思考怎么做'),
      toolNode('bash', '{"command":"sleep 300"}', '(running)'),
    ]
    const entries = snapshotEntriesOf(nodes)
    expect(entries.map(e => e.kind)).toEqual(['request', 'thinking', 'tool'])
    expect(entries[0]?.text).toBe('主线在飞的任务')
    expect(entries[2]?.toolName).toBe('bash')
    expect(entries[2]?.text).toContain('sleep 300')
  })

  it('压缩摘要节点（投影里的 user 形态替换消息）作为起点同样正确', () => {
    const nodes = [
      userNode('最早的问题'),
      userNode('<compacted-summary>前 6 小时进展摘要</compacted-summary>'),
      assistantNode('继续干活'),
      toolNode('read', '{"file_path":"a.ts"}', 'file content'),
    ]
    const entries = snapshotEntriesOf(nodes)
    expect(entries[0]?.text).toContain('compacted-summary')
    expect(entries.map(e => e.kind)).toEqual(['request', 'reply', 'tool'])
  })

  it('在途流式输出（partial）追加为 streaming 拍', () => {
    const entries = snapshotEntriesOf([userNode('任务')], { blocks: [{ kind: 'text', text: '正在输出' }] })
    expect(entries.map(e => e.kind)).toEqual(['request', 'streaming'])
  })

  it('无 user 节点（空历史）→ 空序列', () => {
    expect(snapshotEntriesOf([])).toEqual([])
    expect(snapshotEntriesOf([assistantNode('只有回复')])).toEqual([])
  })
})

describe('serializeSnapshot + splitSnapshotPrefix（协议块往返）', () => {
  it('块带标记与 taken-at；拆分后气泡正文干净、快照完整提升', () => {
    const block = serializeSnapshot([
      { kind: 'request', text: '主线任务' },
      { kind: 'tool', toolName: 'bash', text: '调用：{}\n结果：ok' },
    ], new Date(2026, 8, 22, 14, 40))
    expect(block.startsWith(SNAPSHOT_BLOCK_MARK)).toBe(true)
    expect(block).toContain('taken-at="2026-09-22 14:40"')
    expect(block).toContain('侧边会话')

    const messageText = `${block}\n\n用户在侧边真正的问题`
    const split = splitSnapshotPrefix(messageText)
    expect(split).not.toBeNull()
    expect(split?.rest).toBe('用户在侧边真正的问题')
    expect(split?.takenAt).toBe('2026-09-22 14:40')
    expect(split?.snapshot).toContain('<tool-call name="bash">')
  })

  it('无快照标记 / 块未闭合 → null（消息原样渲染，不吃文本）', () => {
    expect(splitSnapshotPrefix('普通消息')).toBeNull()
    expect(splitSnapshotPrefix(`${SNAPSHOT_BLOCK_MARK} 未闭合的内容`)).toBeNull()
  })
})
