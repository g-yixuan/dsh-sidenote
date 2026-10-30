// Install ranges cover two base versions; verification always pins exact hosts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import semver from 'semver'

const args = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(args[0] && !args[0].startsWith('--') ? args.shift() : 'package.json', 'utf8'))
const support = manifest.dshSupport
assert(support && typeof support === 'object', 'Missing dshSupport series window')
assert.deepEqual(Object.keys(support).sort(), ['current', 'previous'], 'Expected current and previous series')
assert(support.current, 'A current series is required')
const series = [support.previous, support.current].filter(value => value !== null)
const baseOf = version => { const v = semver.parse(version); return v && `${v.major}.${v.minor}.${v.patch}` }
const releaseVersion = version => typeof version === 'string' && semver.valid(version) === version && (semver.prerelease(version) === null || /^\d+\.\d+\.\d+-rc\.\d+$/.test(version))
const ranges = series.map(entry => {
  assert.deepEqual(Object.keys(entry).sort(), ['minimum', 'verified'], 'Expected minimum and verified versions')
  assert(releaseVersion(entry.minimum), 'Minimum must be an exact RC or release')
  const minimum = semver.parse(entry.minimum)
  const range = `>=${entry.minimum} <${minimum.major}.${minimum.minor}.${minimum.patch + 1}-0`
  assert(Array.isArray(entry.verified) && entry.verified[0] === entry.minimum, 'Verification must start at the minimum')
  assert(entry.verified.every(version => releaseVersion(version) && baseOf(version) === baseOf(entry.minimum) && semver.satisfies(version, range)), 'Verified hosts must belong to their series')
  assert(entry.verified.every((version, i) => i === 0 || semver.gt(version, entry.verified[i - 1])), 'Verified hosts must be unique and sorted')
  return range
})
if (support.previous) assert(semver.lt(baseOf(support.previous.minimum), baseOf(support.current.minimum)), 'Previous must precede the current series')
const range = ranges.join(' || ')
assert.equal(manifest.engines?.dsh, range, 'engines.dsh differs from the series window')
assert.equal(manifest.dsh?.engines?.dsh, range, 'dsh.engines.dsh differs from the series window')
assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-primitives'], range, 'UI primitives peer differs from the series window')
assert(!manifest.peerDependencies?.['dsh-better-sidebar'], 'Native hosts must not require better-sidebar')

const verified = new Set(series.flatMap(entry => entry.verified))
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
  const latest = series.map(entry => published.findLast(version => baseOf(version) === baseOf(entry.minimum)))
  const channels = ['latest', 'next'].flatMap(channel => {
    const version = registry['dist-tags'][channel]
    return version ? [{ channel, version, eligible: eligible(version), verified: verified.has(version) }] : []
  })
  const targets = all ? published : published.filter(version => !verified.has(version) || latest.includes(version) || channels.some(channel => channel.version === version))
  console.log(JSON.stringify({ channels, unverified: published.filter(version => !verified.has(version)), matrix: matrix(targets) }))
} else {
  assert(mode === undefined, `Unknown option: ${mode}`)
  console.log(JSON.stringify(matrix(all ? [...verified] : series.flatMap(entry => [entry.minimum, entry.verified.at(-1)]))))
}
