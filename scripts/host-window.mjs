// The current RC/release series and one optional alpha series pin exact evidence.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import semver from 'semver'

const args = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(args[0] && !args[0].startsWith('--') ? args.shift() : 'package.json', 'utf8'))
const shardOption = args.indexOf('--shards')
const shards = shardOption === -1 ? 1 : Number(args.splice(shardOption, 2)[1])
assert(Number.isSafeInteger(shards) && shards > 0, '--shards must be a positive integer')
const support = manifest.dshSupport
assert(support && typeof support === 'object', 'Missing dshSupport series window')
assert.deepEqual(Object.keys(support).sort(), support.alpha === undefined ? ['minimum', 'verified'] : ['alpha', 'minimum', 'verified'], 'Expected the current series and at most one alpha series')
const releaseVersion = version => typeof version === 'string' && semver.valid(version) === version && (semver.prerelease(version) === null || /^\d+\.\d+\.\d+-(?:rc|alpha)\.\d+$/.test(version))
const series = [{ minimum: support.minimum, verified: support.verified }, ...(support.alpha === undefined ? [] : [support.alpha])]
const range = series.map((entry, index) => {
  assert(entry && typeof entry === 'object', 'Missing series window')
  assert.deepEqual(Object.keys(entry).sort(), ['minimum', 'verified'], 'Series must contain minimum and verified versions')
  assert(releaseVersion(entry.minimum), 'Minimum must be an exact alpha, RC or release')
  const minimum = semver.parse(entry.minimum)
  const alpha = index === 1
  assert(alpha ? minimum.prerelease[0] === 'alpha' : minimum.prerelease[0] !== 'alpha', 'Minimum must match its series channel')
  if (alpha) assert(semver.gt(entry.minimum, support.minimum), 'Alpha must belong to a newer base-version series')
  const upper = alpha ? `${minimum.major}.${minimum.minor}.${minimum.patch}-beta` : `${minimum.major}.${minimum.minor}.${minimum.patch + 1}-0`
  const window = `>=${entry.minimum} <${upper}`
  assert(Array.isArray(entry.verified) && entry.verified[0] === entry.minimum, 'Verification must start at the minimum')
  assert(entry.verified.every(version => releaseVersion(version) && semver.satisfies(version, window)), 'Verified hosts must belong to their series')
  assert(entry.verified.every((version, i) => i === 0 || semver.gt(version, entry.verified[i - 1])), 'Verified hosts must be unique and sorted')
  return window
}).join(' || ')
assert.equal(manifest.engines?.dsh, range, 'engines.dsh differs from the series window')
assert.equal(manifest.dsh?.engines?.dsh, range, 'dsh.engines.dsh differs from the series window')
assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-primitives'], range, 'UI primitives peer differs from the series window')
assert(!manifest.peerDependencies?.['dsh-better-sidebar'], 'Native hosts must not require better-sidebar')

const verified = new Set(series.flatMap(entry => entry.verified))
const eligible = version => releaseVersion(version) && semver.satisfies(version, range)
const matrix = versions => ({
  include: [...new Set(versions)].sort(semver.compare).flatMap(version => Array.from({ length: shards }, (_, index) => ({
    'dsh-version': version, 'bs-version': 'none', 'shard-index': index + 1, 'shard-total': shards,
  }))),
})
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
  const latest = series.map(entry => published.findLast(version => semver.coerce(version).version === semver.coerce(entry.minimum).version))
  const channels = ['latest', 'next', 'alpha'].flatMap(channel => {
    const version = registry['dist-tags'][channel]
    return version ? [{
      channel,
      version,
      eligible: eligible(version),
      verified: verified.has(version),
      olderThanMinimum: semver.valid(version) !== null && semver.lt(version, support.minimum),
    }] : []
  })
  const targets = all ? published : published.filter(version => !verified.has(version) || latest.includes(version) || channels.some(channel => channel.version === version))
  console.log(JSON.stringify({ channels, unverified: published.filter(version => !verified.has(version)), matrix: matrix(targets) }))
} else {
  assert(mode === undefined, `Unknown option: ${mode}`)
  console.log(JSON.stringify(matrix(all ? [...verified] : series.flatMap(entry => [entry.minimum, entry.verified.at(-1)]))))
}
