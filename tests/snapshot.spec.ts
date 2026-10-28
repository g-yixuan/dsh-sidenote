/**
 * 主线进展快照（Delivery_04 / WI-02/03）单测：当前 turn 内容提取、协议块
 * 序列化、呈现层的块拆分（气泡只留正文、快照提升到继承卡）。
 */
import { describe, expect, it } from 'vitest'
import { buildMainlineSnapshot, effectiveContextNodes, serializeSnapshot, snapshotEntriesOf, snapshotEntriesFromText, SNAPSHOT_BLOCK_MARK } from '../src/client/sidechat/snapshot.ts'
import type { Context } from '../src/client/host/contracts.ts'
import type { ContextEvent } from '../src/client/host/chat.ts'
import { splitSnapshotPrefix } from '../src/client/sidechat/snapshot.ts'

it('renders saved progress as readable entries without exposing protocol markup', () => {
  const entries = [{ kind: 'request' as const, text: '检查目录' }, { kind: 'tool' as const, toolName: 'read', text: '完整输出\n第二行' }]
  expect(snapshotEntriesFromText(serializeSnapshot(entries, new Date('2026-10-24T12:00:00Z')))).toEqual(entries)
})

it('records an empty but readable first-send cut instead of deferring it to the second message', () => {
  const ctx = { get: () => undefined, sessions: { binding: () => ({ session: { getSnapshot: () => ({ nodes: [] }) } }) } } as unknown as Context
  const text = buildMainlineSnapshot(ctx, 'parent', new Date(2026, 9, 27, 12, 0), 42)!
  expect(splitSnapshotPrefix(text)?.takenAt).toBe('2026-10-27 12:00')
  expect(snapshotEntriesFromText(text)).toEqual([])
})

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

describe('committed compaction checkpoints', () => {
  const compact = (seq: number, shadowedSeqs: number[], text: string): ContextEvent[] => [
    { type: 'compaction/summary', seq: seq - 1, data: { summary: [{ type: 'text', text }], shadowedSeqs } },
    { type: 'user/message', seq, data: { source: { kind: 'compact-checkpoint' }, content: [{ type: 'text', text }] }, surfaceOp: { op: 'replace', startSeq: shadowedSeqs[0]!, endSeq: shadowedSeqs.at(-1)! } },
  ]
  const nodes = [userNode('obsolete original'), { ...assistantNode('obsolete answer'), seq: 2 },
    { ...userNode('retained before latest checkpoint'), seq: 5 }, { kind: 'compaction', seq: 8, summary: 'old summary' },
    { ...userNode('retained recent tail'), seq: 9 }, { kind: 'compaction', seq: 14, summary: 'latest summary' },
    { ...userNode('new steering'), kind: 'steering', seq: 16 }]
  const window = { entries: [...compact(8, [1, 2], 'old summary'), ...compact(14, [8, 5], 'latest summary')].map(event => ({ event })) }
  it.each([false, true])('uses the retained pruned tool result instead of its audit original (checkpoint=%s)', hasCheckpoint => {
    const nodes = [userNode('task'), { ...toolNode('read', '{}', 'large audit-only result'), seq: 5 }]
    const events = [
      ...(hasCheckpoint ? compact(3, [1], 'latest summary') : []),
      { type: 'compaction/prune', seq: 6, data: { shadowedSeqs: [5] } },
      { type: 'tool/result', seq: 7, data: { message: { content: [{ type: 'text', text: 'retained head … retained tail' }] } }, surfaceOp: { op: 'replace', startSeq: 5, endSeq: 5 } },
    ] as ContextEvent[]
    const result = snapshotEntriesOf(effectiveContextNodes(nodes, { entries: events.map(event => ({ event })) }).nodes, undefined, -1)
    expect(result.at(-1)).toMatchObject({ kind: 'tool', toolName: 'read', text: '调用：{}\nretained head … retained tail' })
    expect(JSON.stringify(result)).not.toContain('large audit-only result')
  })
  it('keeps only the latest checkpoint and its surviving tail, even when replacement endpoints run backwards', () => {
    const context = effectiveContextNodes(nodes, window)
    expect(context.checkpointSeq).toBe(14)
    expect(snapshotEntriesOf(context.nodes, undefined, -1).map(entry => entry.text)).toEqual(['latest summary', 'retained recent tail', 'new steering'])
    // A checkpoint newer than the fork supersedes that earlier context and
    // includes the retained pre-checkpoint tail; a later fork sends only its delta.
    expect(snapshotEntriesOf(context.nodes, undefined, 10).map(entry => entry.text)).toEqual(['latest summary', 'retained recent tail', 'new steering'])
    expect(snapshotEntriesOf(context.nodes, undefined, 15).map(entry => entry.text)).toEqual(['new steering'])
  })
  it('does not hide history for a failed or still running summary without a committed replacement', () => {
    const partial = { entries: [...window.entries.slice(0, 2), window.entries[2]!] }
    const context = effectiveContextNodes(nodes.filter(node => node.seq < 14), partial)
    expect(snapshotEntriesOf(context.nodes, undefined, -1).map(entry => entry.text)).toEqual(['old summary', 'retained before latest checkpoint', 'retained recent tail'])
  })
  it('uses the checkpoint at the inherited cut, not a later main or side compaction', () => {
    const context = effectiveContextNodes(nodes, window, 10)
    expect(context.checkpointSeq).toBe(8)
    expect(snapshotEntriesOf(context.nodes, undefined, -1).map(entry => entry.text)).toEqual(['old summary', 'retained before latest checkpoint', 'retained recent tail'])
  })
})

describe('snapshotEntriesOf（当前 turn 内容提取）', () => {
  it('includes the whole suffix after the actual fork cut, across steering and later turns', () => {
    const nodes = [userNode('inherited'),
      { ...userNode('original task'), seq: 11 },
      { ...assistantNode('progress before steering'), seq: 12 },
      { ...userNode('first steering'), kind: 'steering', seq: 13 },
      { ...toolNode('read', '{}', 'tool result'), seq: 14 },
      { ...userNode('second steering'), kind: 'steering', seq: 15 },
    ]
    expect(snapshotEntriesOf(nodes, undefined, 10).map(entry => entry.text)).toEqual([
      'original task', 'progress before steering', 'first steering', '调用：{}\ntool result', 'second steering',
    ])
  })
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

  it('includes in-flight reasoning and tools before a result or final answer exists', () => {
    const entries = snapshotEntriesOf([], { blocks: [{ kind: 'reasoning', text: 'Checking the directory' }] }, 10, [{ name: 'bash', argsRaw: '{"command":"pwd"}' }])
    expect(entries).toEqual([{ kind: 'thinking', text: 'Checking the directory', unfinished: true }, { kind: 'tool', toolName: 'bash', text: '调用：{"command":"pwd"}', unfinished: true }])
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

it('persists a first-send cut and unfinished states without a perpetual live marker', () => {
  const entries = snapshotEntriesOf([], { blocks: [{ kind: 'text', text: 'partial answer' }] }, 7, [{ name: 'bash', argsRaw: '{}' }])
  const text = serializeSnapshot(entries, new Date(2026, 9, 28, 12), 7)
  expect(splitSnapshotPrefix(text)?.boundarySeq).toBe(7)
  expect(snapshotEntriesFromText(text)).toEqual(entries)
  expect(text).not.toContain('（执行中）')
  expect(snapshotEntriesFromText('<streaming>old partial\n（主线正在输出中）</streaming><tool-call name="bash">old call\n（执行中）</tool-call>')).toEqual([
    { kind: 'streaming', text: 'old partial', unfinished: true },
    { kind: 'tool', toolName: 'bash', text: 'old call', unfinished: true },
  ])
})

it('round-trips quoted protocol tags and tool output without truncating the captured context', () => {
  const entries = [{ kind: 'request' as const, text: '解释 </mainline-progress-snapshot> 与 &lt;reply&gt;' }, { kind: 'tool' as const, toolName: 'a"b', text: '<tool-call name="x">nested</tool-call> & result' }]
  const block = serializeSnapshot(entries, new Date(), 4)
  const split = splitSnapshotPrefix(block + '\n\nside question')!
  expect(split.rest).toBe('side question')
  expect(snapshotEntriesFromText(split.snapshot)).toEqual(entries)
})


it('freezes image-only and image-plus-text mainline increments without losing attachment identity', () => {
  const attachment = { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 100, width: 10, height: 10, name: 'x<y>"&.png' }
  const entries = snapshotEntriesOf([
    { kind: 'user', seq: 11, content: [{ type: 'image', attachment }] },
    { kind: 'user', seq: 12, content: [{ type: 'image', attachment }, { type: 'text', text: 'new diagram' }] },
  ], undefined, 10)
  expect(entries).toEqual([{ kind: 'request', text: '', images: [attachment] }, { kind: 'request', text: 'new diagram', images: [attachment] }])
  expect(snapshotEntriesFromText(serializeSnapshot(entries, new Date(), 10))).toEqual(entries)
})
