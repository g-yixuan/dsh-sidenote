import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('bounded native host window', () => {
  it('keeps install declarations and the two CI hosts aligned', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const hosts = ['0.2.0-rc.2', '0.2.1-rc.2']
    const range = hosts.map(host => '=' + host).join(' || ')
    expect(manifest.engines.dsh).toBe(range)
    expect(manifest.dsh.engines.dsh).toBe(range)
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-primitives']).toBe(range)
    expect(manifest.peerDependencies['dsh-better-sidebar']).toBeUndefined()
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect([...workflow.matchAll(/dsh-version: '([^']+)'/g)].map(match => match[1])).toEqual(hosts)
    expect([...workflow.matchAll(/bs-version: '([^']+)'/g)].map(match => match[1])).toEqual(['none', 'none'])
  })
})
