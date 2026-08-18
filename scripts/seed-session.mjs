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
    sessionListMetadata: { ver: 1, seq: 6, val: { blank: false, lastPromptAt: t0 + 4 } },
  },
}
writeFileSync(projcachePath, JSON.stringify(projcache))
console.log(sessionId)
