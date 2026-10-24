import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const manifest = () => JSON.parse(readFileSync('package.json', 'utf8'))
function resolve(value = manifest()) {
  const dir = mkdtempSync(join(tmpdir(), 'sidenote-window-'))
  try {
    const file = join(dir, 'package.json')
    writeFileSync(file, JSON.stringify(value))
    return spawnSync(process.execPath, ['scripts/host-window.mjs', file], { encoding: 'utf8' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('role-based native host window', () => {
  it('generates CI hosts from the admitted roles and exact install declarations', () => {
    const value = manifest()
    const result = resolve(value)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).include).toEqual(
      [value.dshSupport.previous, value.dshSupport.current, value.dshSupport.preview]
        .filter(Boolean).map(host => ({ 'dsh-version': host, 'bs-version': 'none' })),
    )
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(workflow).toContain('node scripts/host-window.mjs')
    expect(workflow).toContain('fromJSON(needs.ci.outputs.host-matrix)')
    expect(workflow).not.toMatch(/dsh-version: '/)
  })

  it('allows an empty preview slot without adding a duplicate or extra host', () => {
    const value = manifest()
    value.dshSupport.preview = null
    const hosts = [value.dshSupport.previous, value.dshSupport.current].filter(Boolean)
    const range = hosts.map(host => '=' + host).join(' || ')
    value.engines.dsh = value.dsh.engines.dsh = value.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'] = range
    const result = resolve(value)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).include).toHaveLength(hosts.length)
  })

  it.each(['current', 'previous', 'preview'])('rejects a floating %s version', role => {
    const value = manifest()
    value.dshSupport[role] = 'next'
    expect(resolve(value).status).not.toBe(0)
  })

  it('rejects duplicate roles and expansion beyond the three slots', () => {
    const value = manifest()
    value.dshSupport.preview = value.dshSupport.current
    expect(resolve(value).stderr).toContain('distinct hosts')
    value.dshSupport.preview = '0.2.1-rc.3'
    value.dshSupport.extra = '0.1.7-rc.2'
    expect(resolve(value).status).not.toBe(0)
  })

  it.each(['engines', 'dsh', 'peerDependencies'])('rejects a stale %s install declaration', field => {
    const value = manifest()
    if (field === 'engines') value.engines.dsh = '=0.2.1-rc.2'
    if (field === 'dsh') value.dsh.engines.dsh = '=0.2.1-rc.2'
    if (field === 'peerDependencies') value.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'] = '=0.2.1-rc.2'
    expect(resolve(value).status).not.toBe(0)
  })

  it.each([
    ['success', 'success', true],
    ['failure', 'success', false],
    ['success', 'failure', false],
    ['success', 'skipped', false],
    ['success', 'cancelled', false],
    ['skipped', 'skipped', false],
  ])('summary gate: ci=%s hosts=%s passes=%s', (ci, host, passes) => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const gate = workflow.split('  host-compatibility:\n')[1]?.split('\n  # Resolve each channel')[0] ?? ''
    expect(gate).toContain('if: always()')
    expect(gate).toContain('needs: [ci, plugin-mount]')
    const command = gate.match(/run: ([^\n]+)/)?.[1]
    expect(command).toBeTruthy()
    const result = spawnSync('bash', ['-c', command!], { env: { ...process.env, CI_RESULT: String(ci), HOST_RESULT: String(host) } })
    expect(result.status === 0).toBe(passes)
  })
})
