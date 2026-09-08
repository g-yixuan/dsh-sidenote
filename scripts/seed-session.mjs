#!/usr/bin/env node
/**
 * Fabricate a minimal but real DSH session log into a scratch DSH_HOME, so the
 * mount smoke can exercise the fork path without any model credential.
 *
 * Usage:
 *   node scripts/seed-session.mjs <DSH_HOME> <workspace-cwd> [sessionId]
 *
 * Writes <DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/session.jsonl.zstd
 * (single-frame zstd — the backend rejects plaintext when configured for
 * compression; the reader does multi-frame decode, so one frame is fine).
 * The fabricated session has one completed turn (user + assistant), so
 * `session.fork` accepts it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'

const [, , dshHome, cwd, sessionId = `session-${crypto.randomUUID()}`] = process.argv
if (!dshHome || !cwd) {
  console.error('usage: node scripts/seed-session.mjs <DSH_HOME> <workspace-cwd> [sessionId]')
  process.exit(1)
}

/** Ported from dsh-session-persistence-jsonl projectKey() (POSIX paths only). */
function projectKey(p) {
  let readable = ''
  let separatorRun = false
  for (const ch of p) {
    const code = ch.codePointAt(0)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (/^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

const t0 = Date.now() - 60_000
const lines = [
  { type: 'session', version: 0, id: sessionId, createdAt: t0, cwd, delegationDepth: 0, agentPreset: 'standard' },
  { type: 'turn/start', seq: 0, time: t0 + 1, data: { turn: 1 } },
  { type: 'session/title', seq: 1, time: t0 + 2, data: { title: 'Side chat plugin review', messageSeqs: [3], source: { kind: 'fallback' } } },
  { type: 'step/start', seq: 2, time: t0 + 3, data: { turn: 1, step: 1 } },
  {
    type: 'user/message', seq: 3, time: t0 + 4,
    data: {
      content: [{ type: 'text', text: 'I forked the main session into a side panel. Review this approach and flag anything risky.' }],
      source: { kind: 'user', rpcId: 'e2e-seed', clientTimeZone: 'Asia/Shanghai' },
      role: 'user', id: 'e2e-user-1',
    },
    surfaceOp: 'append',
  },
  {
    type: 'assistant/message', seq: 4, time: t0 + 5,
    data: {
      turn: 1, step: 1,
      message: {
        role: 'assistant',
        id: 'e2e-assistant-1',
        content: [{ type: 'text', text: 'Forking into a side panel is the right call. A few things worth flagging:\n\n**What works well**\n- The fork takes a full history snapshot, so the side chat starts with complete context\n- Archiving the child keeps the session list clean\n\n**Watch out for**\n- The seed is a deep copy — large histories cost memory per side chat\n- Fork boundaries only land on completed turns\n\n```ts\nconst childId = await ctx.sessions.fork({ sessionId: parent.id })\nawait ctx.workspaces.archiveSession(childId)\n```\n\nOverall: solid approach, ship it.' }],
        source: { kind: 'model', provider: 'e2e', model: 'e2e' },
      },
    },
    surfaceOp: 'append',
  },
  { type: 'step/end', seq: 5, time: t0 + 6, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 6, time: t0 + 7, data: { turn: 1, reason: { kind: 'completed' } } },
  // Turn 2：携带 v3 协议前缀（注释 XML 块）的用户消息——气泡留痕手术的
  // 确定性回归 fixture（无需模型：读历史即可断言隐藏与「N annotated」标签）。
  { type: 'turn/start', seq: 7, time: t0 + 8, data: { turn: 2 } },
  { type: 'step/start', seq: 8, time: t0 + 9, data: { turn: 2, step: 1 } },
  {
    type: 'user/message', seq: 9, time: t0 + 10,
    data: {
      content: [{ type: 'text', text: 'I annotated 1 passage(s) of the conversation above:\n<annotation id="1">\n<quote>the seeded protocol quote</quote>\n<note>watch the memory cost</note>\n</annotation>\n\nLooks good overall' }],
      source: { kind: 'user', rpcId: 'e2e-seed-2', clientTimeZone: 'Asia/Shanghai' },
      role: 'user', id: 'e2e-user-2',
    },
    surfaceOp: 'append',
  },
  {
    type: 'assistant/message', seq: 10, time: t0 + 11,
    data: {
      turn: 2, step: 1,
      message: {
        role: 'assistant',
        id: 'e2e-assistant-2',
        content: [{ type: 'text', text: 'Noted — memory cost is a fair concern.' }],
        source: { kind: 'model', provider: 'e2e', model: 'e2e' },
      },
    },
    surfaceOp: 'append',
  },
  { type: 'step/end', seq: 11, time: t0 + 12, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: 12, time: t0 + 13, data: { turn: 2, reason: { kind: 'completed' } } },
  // Turn 3：一次 Read + 一次 Bash 工具调用——Delivery_03 工具卡渲染（WI-01）
  // 的 e2e 正样本 fixture。日志里只伪造 tool/call + tool/result 事件本身；
  // callView/resultView 不落日志：宿主 api-proxy 在 history/session/event 帧上
  // 现算（dsh-host-apiproxy viewFor：tool/call 走 `ctx.tools.get(name).presentCall
  // (JSON.parse(arguments))`，tool/result 回扫同页 tool/call 配对后走
  // `presentResult(call.args, { content, isError, meta })`），所以种子只需让
  // presenter 各自的输入约束成立：
  //  - read.presentCall（dsh-tool-fs）：args 只需 `file_path`（offset/limit 可选）。
  //  - read.presentResult：result.content 必须是单个 text block 且匹配 envelope
  //    `/^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/`
  //    （formatReadOutput 的产物）；`meta` 必须通过 readMetaFromMeta 语义校验
  //    （offset≥1、行号严格递增且 ≤ totalLines、totalLines≥0）——即真实
  //    `output.presentationMeta(args, value)` 投影出的 FsReadMeta 原样。
  //  - bash.presentCall（dsh-tool-bash）：args 只需 `command`（description 可选、
  //    workdir→cwd；run_in_background:true 会退化成 generic 卡，勿设）。
  //  - bash.presentResult：content 单 text block，末尾 `\n[exit code: N]` 由
  //    dsh-shell parseExitStatus 剥成 `{ output, exitCode }`；无标记则 exitCode: 0。
  // 字段形状均对齐真实日志采样（read_3 / bash_5 会话，见报告 W00）。
  { type: 'turn/start', seq: 13, time: t0 + 14, data: { turn: 3 } },
  { type: 'step/start', seq: 14, time: t0 + 15, data: { turn: 3, step: 1 } },
  {
    type: 'user/message', seq: 15, time: t0 + 16,
    data: {
      content: [{ type: 'text', text: 'Quick check: read the README and list the workspace files.' }],
      source: { kind: 'user', rpcId: 'e2e-seed-3', clientTimeZone: 'Asia/Shanghai' },
      role: 'user', id: 'e2e-user-3',
    },
    surfaceOp: 'append',
  },
  {
    // 模型请求两个并行工具调用：content 的 tool-call blocks（dsh-llm
    // ToolCallBlock：type/id/name/arguments）与下方 tool/call 事件的
    // callId/arguments 逐字一致——真实日志同构（03358b85 会话 seq 139/140）。
    type: 'assistant/message', seq: 16, time: t0 + 17,
    data: {
      turn: 3, step: 1,
      message: {
        role: 'assistant',
        id: 'e2e-assistant-3',
        content: [
          { type: 'text', text: 'Reading the README and listing the workspace files in parallel.' },
          { type: 'tool-call', id: 'read_e2e_1', name: 'read', arguments: '{"file_path":"README.md","offset":1,"limit":3}' },
          { type: 'tool-call', id: 'bash_e2e_1', name: 'bash', arguments: '{"command":"ls -1","description":"List workspace files"}' },
        ],
        source: { kind: 'model', provider: 'e2e', model: 'e2e' },
      },
    },
    surfaceOp: 'append',
  },
  // tool/call 是 log-only 事件（非 SurfaceEventType），不带 surfaceOp。
  {
    type: 'tool/call', seq: 17, time: t0 + 18,
    data: { turn: 3, step: 1, callId: 'read_e2e_1', name: 'read', arguments: '{"file_path":"README.md","offset":1,"limit":3}' },
  },
  {
    type: 'tool/call', seq: 18, time: t0 + 19,
    data: { turn: 3, step: 1, callId: 'bash_e2e_1', name: 'bash', arguments: '{"command":"ls -1","description":"List workspace files"}' },
  },
  // tool/result 是 surface 事件（surfaceOp 必带）；message 是 ToolResultMessage
  // （role:'user'，content=[ToolResultBlock{type:'tool-result',toolCallId,content,
  // isError}]，source={kind:'tool',callId}）；meta 即 presenter 的 presentationMeta。
  {
    type: 'tool/result', seq: 19, time: t0 + 20, surfaceOp: 'append', sourceEventSeqs: [17],
    data: {
      turn: 3, step: 1,
      message: {
        role: 'user',
        id: 'e2e-tool-read-1',
        source: { kind: 'tool', callId: 'read_e2e_1' },
        content: [{
          type: 'tool-result',
          toolCallId: 'read_e2e_1',
          isError: false,
          // formatReadOutput envelope：presentResult 的 body 正则从这里剥出
          // read 卡的 fallback content（无 read 卡能力的 UI 直接渲染这段）。
          content: [{
            type: 'text',
            text: '<path>README.md</path>\n<type>file</type>\n<content>\n1: # dsh-sidenote\n2: \n3: A side-chat plugin for DSH.\n\n(End of file - total 3 lines)\n</content>',
          }],
        }],
      },
      // FsReadMeta（read 工具 output.presentationMeta 的产物原样）：lines 与
      // 上面 envelope 的窗口一致；lang 由扩展名映射（.md → 'md'）。
      meta: {
        path: 'README.md',
        offset: 1,
        lines: [
          { number: 1, text: '# dsh-sidenote' },
          { number: 2, text: '' },
          { number: 3, text: 'A side-chat plugin for DSH.' },
        ],
        totalLines: 3,
        lang: 'md',
      },
    },
  },
  {
    type: 'tool/result', seq: 20, time: t0 + 21, surfaceOp: 'append', sourceEventSeqs: [18],
    data: {
      turn: 3, step: 1,
      message: {
        role: 'user',
        id: 'e2e-tool-bash-1',
        source: { kind: 'tool', callId: 'bash_e2e_1' },
        content: [{
          type: 'tool-result',
          toolCallId: 'bash_e2e_1',
          isError: false,
          // 末尾 exit-code 标记由 parseExitStatus 剥离 → { output, exitCode: 0 }。
          content: [{ type: 'text', text: 'README.md\npackage.json\n\n[exit code: 0]' }],
        }],
      },
    },
  },
  { type: 'step/end', seq: 21, time: t0 + 22, data: { turn: 3, step: 1 } },
  { type: 'step/start', seq: 22, time: t0 + 23, data: { turn: 3, step: 2 } },
  {
    type: 'assistant/message', seq: 23, time: t0 + 24,
    data: {
      turn: 3, step: 2,
      message: {
        role: 'assistant',
        id: 'e2e-assistant-4',
        content: [{ type: 'text', text: 'The README describes this side-chat plugin, and the workspace holds README.md plus package.json. Nothing else to flag.' }],
        source: { kind: 'model', provider: 'e2e', model: 'e2e' },
      },
    },
    surfaceOp: 'append',
  },
  { type: 'step/end', seq: 24, time: t0 + 25, data: { turn: 3, step: 2 } },
  { type: 'turn/end', seq: 25, time: t0 + 26, data: { turn: 3, reason: { kind: 'completed' } } },
  // Turn 4：todo_write 任务卡 + 思考块——todo 卡映射与思考行首行预览的确定性
  // fixture（0.1.1 走 presentCall 的 rawInput=todos 数组；0.1.2 走 argsRaw 推导）。
  { type: 'turn/start', seq: 26, time: t0 + 27, data: { turn: 4 } },
  { type: 'step/start', seq: 27, time: t0 + 28, data: { turn: 4, step: 1 } },
  {
    type: 'assistant/message', seq: 28, time: t0 + 29,
    data: {
      turn: 4, step: 1,
      message: {
        role: 'assistant',
        id: 'e2e-assistant-5',
        content: [
          { type: 'reasoning', text: 'Ship the todo card first, then verify the dual-lane e2e before publishing.' },
          { type: 'tool-call', id: 'todo_e2e_1', name: 'todo_write', arguments: '{"todos":[{"content":"Draft the release notes","status":"completed"},{"content":"Verify the dual-lane e2e","status":"in_progress"},{"content":"Publish to npm","status":"pending"}]}' },
        ],
        source: { kind: 'model', provider: 'e2e', model: 'e2e' },
      },
    },
    surfaceOp: 'append',
  },
  {
    type: 'tool/call', seq: 29, time: t0 + 30,
    data: { turn: 4, step: 1, callId: 'todo_e2e_1', name: 'todo_write', arguments: '{"todos":[{"content":"Draft the release notes","status":"completed"},{"content":"Verify the dual-lane e2e","status":"in_progress"},{"content":"Publish to npm","status":"pending"}]}' },
  },
  {
    type: 'tool/result', seq: 30, time: t0 + 31, surfaceOp: 'append', sourceEventSeqs: [29],
    data: {
      turn: 4, step: 1,
      message: {
        role: 'user',
        id: 'e2e-tool-todo-1',
        source: { kind: 'tool', callId: 'todo_e2e_1' },
        // dsh-tool-todo presenter 的结果正文格式（counts 顺序 pending→in progress→completed）。
        content: [{
          type: 'tool-result',
          toolCallId: 'todo_e2e_1',
          isError: false,
          content: [{ type: 'text', text: 'Updated todo list: 1 pending, 1 in progress, 1 completed.' }],
        }],
      },
    },
  },
  { type: 'step/end', seq: 31, time: t0 + 32, data: { turn: 4, step: 1 } },
  { type: 'turn/end', seq: 32, time: t0 + 33, data: { turn: 4, reason: { kind: 'completed' } } },
]

const dir = join(dshHome, 'sessions', projectKey(cwd), sessionId)
mkdirSync(dir, { recursive: true })
// Frame contract (dsh-session-persistence-jsonl): frame 1 = exactly the header
// line (one trailing \n, nothing else); following frames = event batches.
// Frames are checksummed like the real writer (ZSTD_c_checksumFlag).
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const headerFrame = zstdCompressSync(Buffer.from(JSON.stringify(lines[0]) + '\n', 'utf8'), CHECKSUM)
const eventsFrame = zstdCompressSync(Buffer.from(lines.slice(1).map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8'), CHECKSUM)
writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([headerFrame, eventsFrame]))

// The GUI session list reads titles from the projection cache
// (~/.dsh/storages/session_projcache.json), not from the log — a never-loaded
// cold session would fall back to its cwd basename. Seed the two rows the
// list needs (title + sessionListMetadata).
const storagesDir = join(dshHome, 'storages')
mkdirSync(storagesDir, { recursive: true })
const projcachePath = join(storagesDir, 'session_projcache.json')
let projcache = { unit: { name: 'session_projcache', version: 3 }, global: null, tables: { sessions: {} } }
try {
  projcache = JSON.parse(readFileSync(projcachePath, 'utf8'))
} catch { /* fresh scratch home */ }
projcache.tables.sessions[sessionId] = {
  identity: { createdAt: t0, cwd },
  rows: {
    title: { ver: 1, seq: 6, val: 'Side chat plugin review' },
    // lastPromptAt 跟随最后一个 user prompt（turn 3，seq 15）；seq 随行到日志尾。
    sessionListMetadata: { ver: 1, seq: 32, val: { blank: false, lastPromptAt: t0 + 16 } },
  },
}
writeFileSync(projcachePath, JSON.stringify(projcache))
console.log(sessionId)
