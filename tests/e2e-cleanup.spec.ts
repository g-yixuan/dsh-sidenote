import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = readFileSync(new URL('../scripts/e2e-mount.sh', import.meta.url), 'utf8')
const cleanup = script.slice(script.indexOf('cleanup() {'), script.indexOf('\ntrap cleanup EXIT'))

describe('mount cleanup after a real host restart', () => {
  it.each([{ code: 0, keep: '' }, { code: 7, keep: '' }, { code: 0, keep: '1' }])('waits for shutdown writes and preserves the result (%j)', async ({ code, keep }) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cleanup-test-'))
    const scratch = join(root, 'scratch')
    const original = spawn(process.execPath, ['-e', 'process.exit(0)'])
    await once(original, 'exit')
    const host = spawn(process.execPath, ['--input-type=commonjs', '-e', `
      const fs = require('node:fs')
      fs.mkdirSync(process.env.DSH_TEST_FLUSH_DIR, { recursive: true })
      process.on('SIGTERM', () => setTimeout(() => {
        fs.mkdirSync(process.env.DSH_TEST_FLUSH_DIR, { recursive: true })
        fs.writeFileSync(process.env.DSH_TEST_FLUSH_DIR + '/last-write', 'flushed')
        process.exit(0)
      }, 150))
      setInterval(() => {}, 1000)
      process.send('ready')
    `], { env: { ...process.env, DSH_TEST_FLUSH_DIR: join(scratch, 'home/cache') }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    const stopped = once(host, 'exit')
    try {
      await once(host, 'message')
      writeFileSync(join(scratch, 'server.pid'), String(host.pid))
      const shell = spawn('bash', ['-c', `set -euo pipefail\nwarn() { printf '%s\\n' "$*" >&2; }\n${cleanup}\ntrap cleanup EXIT\nexit "$DSH_TEST_EXIT_CODE"`], {
        env: { ...process.env, SCRATCH: scratch, ROOT: root, SERVER_PID: String(original.pid), WEB_LOG: join(scratch, 'web.log'), KEEP_HOME: keep, DSH_TEST_EXIT_CODE: String(code) },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      shell.stderr.on('data', chunk => { stderr += String(chunk) })
      const [exitCode] = await once(shell, 'exit')
      await stopped
      expect({ exitCode, stderr: stderr.includes('Directory not empty') }).toEqual({ exitCode: code, stderr: false })
      expect(existsSync(scratch)).toBe(Boolean(keep))
      if (keep) expect(readFileSync(join(scratch, 'home/cache/last-write'), 'utf8')).toBe('flushed')
    } finally {
      if (host.exitCode === null) host.kill('SIGKILL')
      await stopped
      rmSync(root, { recursive: true, force: true })
    }
  })
})
