// The admitted role list drives CI; publishing still uses exact install ranges.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(process.argv[2] ?? 'package.json', 'utf8'))
const support = manifest.dshSupport
assert(support && typeof support === 'object', 'Missing dshSupport role list')
assert.deepEqual(Object.keys(support).sort(), ['current', 'previous', 'preview'].sort(), 'Expected current, previous and preview roles')
assert(typeof support.current === 'string', 'A current host is required')
const hosts = [support.previous, support.current, support.preview].filter(host => host !== null)
assert(hosts.every(host => typeof host === 'string' && /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(host)), 'Hosts must be exact versions; absent optional roles use null')
assert.equal(new Set(hosts).size, hosts.length, 'Roles must use distinct hosts; leave preview null when channels coincide')
const range = hosts.map(host => '=' + host).join(' || ')
assert.equal(manifest.engines?.dsh, range, 'engines.dsh differs from the role list')
assert.equal(manifest.dsh?.engines?.dsh, range, 'dsh.engines.dsh differs from the role list')
assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-primitives'], range, 'UI primitives peer differs from the role list')
assert(!manifest.peerDependencies?.['dsh-better-sidebar'], 'Native hosts must not require better-sidebar')
console.log(JSON.stringify({ include: hosts.map(host => ({ 'dsh-version': host, 'bs-version': 'none' })) }))
