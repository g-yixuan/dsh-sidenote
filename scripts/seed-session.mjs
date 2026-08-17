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

import { mkdirSync, writeFileSync } from 'node:fs'
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
  { type: 'turn/start', seq: 1, time: t0 + 1, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: t0 + 2, data: { turn: 1, step: 1 } },
  {
    type: 'user/message', seq: 3, time: t0 + 3,
    data: {
      content: [{ type: 'text', text: 'E2E 种子：请记住「蓝鲸预算」这个词。' }],
      source: { kind: 'user', rpcId: 'e2e-seed', clientTimeZone: 'Asia/Shanghai' },
      role: 'user', id: 'e2e-user-1',
    },
    surfaceOp: 'append',
  },
  {
    type: 'assistant/message', seq: 4, time: t0 + 4,
    data: {
      turn: 1, step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '好的，已记住「蓝鲸预算」。这是 E2E 伪造会话的助手回复，用于验证侧边聊天 fork 后历史可见。\n\n```js\nconsole.log("blue-whale")\n```' }],
        source: { kind: 'model', provider: 'e2e', model: 'e2e' },
      },
    },
    surfaceOp: 'append',
  },
  { type: 'step/end', seq: 5, time: t0 + 5, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 6, time: t0 + 6, data: { turn: 1, reason: { kind: 'completed' } } },
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
console.log(sessionId)
