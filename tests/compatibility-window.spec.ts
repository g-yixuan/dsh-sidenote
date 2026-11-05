import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const liveManifest = () => JSON.parse(readFileSync('package.json', 'utf8'))
/** Previous metadata remains a supported input to the window generator. */
function manifest() {
  const value = liveManifest()
  value.dshSupport = {
    minimum: '0.2.1-rc.2', verified: ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5'],
    alpha: { minimum: '0.2.2-alpha.3', verified: ['0.2.2-alpha.3'] },
  }
  value.engines.dsh = value.dsh.engines.dsh = value.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'] = '>=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-alpha.3 <0.2.2-beta'
  return value
}
function resolve(value = manifest(), args: string[] = [], registry?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'sidenote-window-'))
  try {
    const file = join(dir, 'package.json')
    writeFileSync(file, JSON.stringify(value))
    if (registry) {
      writeFileSync(join(dir, 'registry.json'), JSON.stringify(registry))
      args = ['--discover', join(dir, 'registry.json'), ...args]
    }
    return spawnSync(process.execPath, ['scripts/host-window.mjs', file, ...args], { encoding: 'utf8' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const hosts = (result: ReturnType<typeof resolve>) => {
  expect(result.status, result.stderr).toBe(0)
  const output = JSON.parse(result.stdout)
  return (output.matrix ?? output).include.map((row: { 'dsh-version': string }) => row['dsh-version'])
}

describe('current and alpha native host windows', () => {
  it('admits the new RC series and rejects old hosts for the current plugin', () => {
    const value = liveManifest()
    expect(hosts(resolve(value))).toEqual(['0.2.2-rc.1'])
    for (const version of ['0.2.1-rc.5', '0.2.1', '0.2.2-alpha.3', '0.2.3-alpha.1']) {
      expect(JSON.parse(resolve(value, ['--candidate', version]).stdout).eligible).toBe(false)
    }
    for (const version of ['0.2.2-rc.1', '0.2.2-rc.100', '0.2.2']) {
      expect(JSON.parse(resolve(value, ['--candidate', version]).stdout).eligible).toBe(true)
    }
  })

  it('records older channels after rollover and still requires admission for newer series', () => {
    const registry = {
      versions: ['0.2.1-rc.5', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.3-alpha.1'],
      'dist-tags': { latest: '0.2.1-rc.5', next: '0.2.2-rc.1', alpha: '0.2.2-alpha.3' },
    }
    const result = resolve(liveManifest(), [], registry)
    expect(hosts(result)).toEqual(['0.2.2-rc.1'])
    const plan = JSON.parse(result.stdout)
    expect(plan.channels.filter((channel: { eligible: boolean; olderThanMinimum: boolean }) => !channel.eligible && !channel.olderThanMinimum)).toEqual([])
    registry['dist-tags'].alpha = '0.2.3-alpha.1'
    const advanced = JSON.parse(resolve(liveManifest(), [], registry).stdout)
    expect(advanced.channels.filter((channel: { eligible: boolean; olderThanMinimum: boolean }) => !channel.eligible && !channel.olderThanMinimum)).toEqual([
      { channel: 'alpha', version: '0.2.3-alpha.1', eligible: false, verified: false, olderThanMinimum: false },
    ])
  })
  it('bounds required PR checks while retaining the full verified inventory', () => {
    expect(hosts(resolve())).toEqual(['0.2.1-rc.2', '0.2.1-rc.5', '0.2.2-alpha.3'])
    expect(hosts(resolve(manifest(), ['--all']))).toEqual(['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.3'])
    const value = manifest()
    value.dshSupport.alpha.verified.push('0.2.2-alpha.4')
    expect(hosts(resolve(value))).toEqual(['0.2.1-rc.2', '0.2.1-rc.5', '0.2.2-alpha.3', '0.2.2-alpha.4'])
  })

  it.each([
    ['0.2.0-rc.1', false, false], ['0.2.0-rc.2', false, false],
    ['0.2.0-rc.99', false, false], ['0.2.0', false, false],
    ['0.2.1-alpha.99', false, false], ['0.2.1-beta.99', false, false], ['0.2.1-rc.1', false, false],
    ['0.2.1-rc.3', true, true], ['0.2.1-rc.4', true, true], ['0.2.1-rc.5', true, true],
    ['0.2.1-rc.100', true, false], ['0.2.1', true, false],
    ['0.2.2-alpha.2', false, false], ['0.2.2-alpha.3', true, true], ['0.2.2-alpha.100', true, false],
    ['0.2.2-beta', false, false], ['0.2.2-beta.1', false, false], ['0.2.2-rc.1', false, false], ['0.2.2', false, false],
    ['0.2.3-alpha.1', false, false], ['0.3.0', false, false], ['latest', false, false],
  ])('distinguishes install eligibility from evidence for %s', (version, eligible, verified) => {
    const result = resolve(manifest(), ['--candidate', version])
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ version, eligible, verified })
  })

  it('discovers every unseen RC even after tags advance, without admitting a new series', () => {
    const registry = { versions: ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.1-rc.6', '0.2.1-rc.7', '0.2.2-alpha.3'], 'dist-tags': { latest: '0.2.1-rc.7', next: '0.2.2-beta.1', alpha: '0.2.2-alpha.3' } }
    const result = resolve(manifest(), [], registry)
    expect(hosts(result)).toEqual(['0.2.1-rc.6', '0.2.1-rc.7', '0.2.2-alpha.3'])
    const plan = JSON.parse(result.stdout)
    expect(plan.unverified).toEqual(['0.2.1-rc.6', '0.2.1-rc.7'])
    expect(plan.channels).toContainEqual({ channel: 'next', version: '0.2.2-beta.1', eligible: false, verified: false, olderThanMinimum: false })
    expect(plan.channels).toContainEqual({ channel: 'alpha', version: '0.2.2-alpha.3', eligible: true, verified: true, olderThanMinimum: false })
    expect(hosts(resolve(manifest(), ['--all'], registry))).toEqual(registry.versions.slice(1))
  })

  it('deduplicates matching latest/next channels and rejects incomplete registry evidence', () => {
    const registry = { versions: ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.3'], 'dist-tags': { latest: '0.2.1-rc.5', next: '0.2.1-rc.5' } }
    expect(hosts(resolve(manifest(), [], registry))).toEqual(['0.2.1-rc.5', '0.2.2-alpha.3'])
    expect(resolve(manifest(), [], { ...registry, versions: [] }).status).not.toBe(0)
  })

  it('keeps each series latest host when all dist-tags have moved outside the windows', () => {
    const registry = { versions: ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.2-alpha.3', '0.2.2-alpha.4', '0.2.2-alpha.5'], 'dist-tags': { latest: '0.2.2-rc.1', alpha: '0.2.3-alpha.1' } }
    const result = resolve(manifest(), [], registry)
    expect(hosts(result)).toEqual(['0.2.1-rc.5', '0.2.2-alpha.4', '0.2.2-alpha.5'])
    expect(JSON.parse(result.stdout).unverified).toEqual(['0.2.2-alpha.4', '0.2.2-alpha.5'])
    expect(hosts(resolve(manifest(), ['--all'], registry))).toEqual(registry.versions)
  })

  it('rolls the complete series while leaving the former series to historical packages', () => {
    const value = manifest()
    value.dshSupport = { minimum: '0.2.2-rc.1', verified: ['0.2.2-rc.1'] }
    value.engines.dsh = value.dsh.engines.dsh = value.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'] = '>=0.2.2-rc.1 <0.2.3-0'
    expect(hosts(resolve(value))).toEqual(['0.2.2-rc.1'])
    expect(JSON.parse(resolve(value, ['--candidate', '0.2.1-rc.99']).stdout).eligible).toBe(false)
    expect(JSON.parse(resolve(value, ['--candidate', '0.2.2-rc.99']).stdout).eligible).toBe(true)
  })

  it.each(['wrong-series', 'duplicate', 'unsorted', 'missing-floor', 'alpha-floor', 'extra-series'])('rejects invalid verification metadata: %s', fault => {
    const value = manifest(), current = value.dshSupport
    if (fault === 'wrong-series') current.verified.push('0.2.2-rc.1')
    if (fault === 'duplicate') current.verified.push('0.2.1-rc.5')
    if (fault === 'unsorted') current.verified.reverse()
    if (fault === 'missing-floor') current.verified.shift()
    if (fault === 'alpha-floor') current.minimum = '0.2.1-alpha.2'
    if (fault === 'extra-series') value.dshSupport.previous = { minimum: '0.2.0-rc.2', verified: ['0.2.0-rc.2'] }
    expect(resolve(value).status).not.toBe(0)
  })

  it.each(['rc-floor', 'same-series', 'beta-evidence', 'missing-floor', 'duplicate'])('rejects invalid alpha metadata: %s', fault => {
    const value = manifest(), alpha = value.dshSupport.alpha
    if (fault === 'rc-floor') alpha.minimum = '0.2.2-rc.1'
    if (fault === 'same-series') alpha.minimum = '0.2.1-alpha.3'
    if (fault === 'beta-evidence') alpha.verified.push('0.2.2-beta.1')
    if (fault === 'missing-floor') alpha.verified = []
    if (fault === 'duplicate') alpha.verified.push(alpha.minimum)
    expect(resolve(value).status).not.toBe(0)
  })

  it.each(['engines', 'dsh', 'peerDependencies'])('rejects an inconsistent %s install declaration', field => {
    const value = manifest()
    if (field === 'engines') value.engines.dsh = '>=0.2.0-rc.2'
    if (field === 'dsh') value.dsh.engines.dsh = '>=0.2.0-rc.2'
    if (field === 'peerDependencies') value.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'] = '>=0.2.0-rc.2'
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
    const gate = workflow.split('  host-compatibility:\n')[1]?.split('\n  host-discovery:')[0] ?? ''
    expect(gate).toContain('if: always()')
    expect(gate).toContain('needs: [ci, plugin-mount]')
    const command = gate.match(/run: ([^\n]+)/)?.[1]
    expect(command).toBeTruthy()
    const result = spawnSync('bash', ['-c', command!], { env: { ...process.env, CI_RESULT: String(ci), HOST_RESULT: String(host) } })
    expect(result.status === 0).toBe(passes)
  })
})
