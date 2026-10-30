// One base-version series is installable; verification always pins exact hosts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import semver from 'semver'

const args = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(args[0] && !args[0].startsWith('--') ? args.shift() : 'package.json', 'utf8'))
const support = manifest.dshSupport
assert(support && typeof support === 'object', 'Missing dshSupport series window')
assert.deepEqual(Object.keys(support).sort(), ['minimum', 'verified'], 'Expected one series with minimum and verified versions')
const releaseVersion = version => typeof version === 'string' && semver.valid(version) === version && (semver.prerelease(version) === null || /^\d+\.\d+\.\d+-rc\.\d+$/.test(version))
assert(releaseVersion(support.minimum), 'Minimum must be an exact RC or release')
const minimum = semver.parse(support.minimum)
const range = `>=${support.minimum} <${minimum.major}.${minimum.minor}.${minimum.patch + 1}-0`
assert(Array.isArray(support.verified) && support.verified[0] === support.minimum, 'Verification must start at the minimum')
assert(support.verified.every(version => releaseVersion(version) && semver.satisfies(version, range)), 'Verified hosts must belong to the current series')
assert(support.verified.every((version, i) => i === 0 || semver.gt(version, support.verified[i - 1])), 'Verified hosts must be unique and sorted')
assert.equal(manifest.engines?.dsh, range, 'engines.dsh differs from the series window')
assert.equal(manifest.dsh?.engines?.dsh, range, 'dsh.engines.dsh differs from the series window')
assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-primitives'], range, 'UI primitives peer differs from the series window')
assert(!manifest.peerDependencies?.['dsh-better-sidebar'], 'Native hosts must not require better-sidebar')

const verified = new Set(support.verified)
const eligible = version => releaseVersion(version) && semver.satisfies(version, range)
const matrix = versions => ({ include: [...new Set(versions)].sort(semver.compare).map(version => ({ 'dsh-version': version, 'bs-version': 'none' })) })
const all = args.includes('--all')
const mode = args.find(arg => arg !== '--all')
if (mode === '--candidate') {
  const version = args[args.indexOf(mode) + 1]
  console.log(JSON.stringify({ version, eligible: eligible(version), verified: verified.has(version) }))
} else if (mode === '--discover') {
  // Resolve npm once. Installable and verified are intentionally distinct.
  const registry = JSON.parse(readFileSync(args[args.indexOf(mode) + 1], 'utf8'))
  assert(Array.isArray(registry.versions) && registry['dist-tags']?.latest, 'Incomplete npm host inventory')
  const published = registry.versions.filter(eligible).sort(semver.compare)
  for (const version of verified) assert(published.includes(version), `Verified host missing from registry: ${version}`)
  const latest = published.at(-1)
  const channels = ['latest', 'next'].flatMap(channel => {
    const version = registry['dist-tags'][channel]
    return version ? [{ channel, version, eligible: eligible(version), verified: verified.has(version) }] : []
  })
  const targets = all ? published : published.filter(version => !verified.has(version) || version === latest || channels.some(channel => channel.version === version))
  console.log(JSON.stringify({ channels, unverified: published.filter(version => !verified.has(version)), matrix: matrix(targets) }))
} else {
  assert(mode === undefined, `Unknown option: ${mode}`)
  console.log(JSON.stringify(matrix(all ? [...verified] : [support.minimum, support.verified.at(-1)])))
}
