/** Deploy a committed build into a new profile directory without restarting DSH. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const profileArg = option('--profile')
const hostArg = option('--host-source')
if (!profileArg || !hostArg) throw Error('Usage: node scripts/deploy-local.mjs --profile <directory> --host-source <DSH checkout> [--dry-run | --restore]')
const profile = path.resolve(profileArg)
const host = path.resolve(hostArg)
const yaml = createRequire(path.join(host, 'package.json'))('js-yaml')
const file = path.join(profile, 'cordis.patch.yml')
const original = fs.readFileSync(file, 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
const base = path.join(profile, 'plugins', 'local-sidenote')
const pointer = path.join(base, 'deployment.json')
function replace(expected, next) {
  if (fs.readFileSync(file, 'utf8') !== expected) throw Error('Profile changed concurrently; deployment cancelled')
  const temporary = file + '.sidenote.' + process.pid + '.tmp'
  fs.writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 })
  if (fs.readFileSync(file, 'utf8') !== expected) { fs.unlinkSync(temporary); throw Error('Profile changed concurrently; deployment cancelled') }
  fs.renameSync(temporary, file)
}
if (process.argv.includes('--restore')) {
  const previous = JSON.parse(fs.readFileSync(pointer, 'utf8'))
  if (hash(original) !== previous.patchHash) throw Error('Profile changed after deployment; merge the saved plugin rows instead of replacing unrelated changes')
  const backup = fs.readFileSync(previous.backup, 'utf8')
  if (!process.argv.includes('--dry-run')) replace(original, backup)
  console.log(JSON.stringify({ restored: !process.argv.includes('--dry-run'), backup: previous.backup }))
} else {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  if (git('status', '--porcelain')) throw Error('Commit the source and tests before deployment')
  const commit = git('rev-parse', 'HEAD')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const hostVersion = JSON.parse(fs.readFileSync(path.join(host, 'apps/cli/package.json'), 'utf8')).version
  const semver = createRequire(path.join(root, 'package.json'))('semver')
  if (!semver.satisfies(hostVersion, manifest.engines.dsh, { includePrerelease: true })) throw Error('The current DSH version is outside this plugin build’s support range')
  const client = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  if (!client.includes('previewSelection') || !client.includes('mountedConversationIds')) throw Error('Build the current refactor before deployment')
  // Replace exactly the official plugin row. All other bytes, including !!js, remain untouched.
  const blocks = original.match(/^-[\s\S]*?(?=^-(?:\s|$)|$(?![\s\S]))/gm) ?? []
  const block = blocks.find(value => /^- id: side-chat\s*$/m.test(value))
  if (!block) throw Error('Expected one top-level side-chat profile override')
  const row = yaml.load(block)[0]
  if (row.name !== 'dsh-sidenote') throw Error('The side-chat row belongs to a different plugin')
  if (original.includes('sidenote-local-')) throw Error('A local deployment already exists; restore it before deploying another build')
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '')
  const release = path.join(base, commit.slice(0, 12) + '-' + stamp)
  const id = 'sidenote-local-' + stamp
  const disabled = { ...row, disabled: true }
  const local = { id, name: pathToFileURL(path.join(release, 'lib/index.js')).href, ...(row.config ? { config: row.config } : {}) }
  const next = original.replace(block, yaml.dump([disabled], { lineWidth: -1, noRefs: true }))
    .replace(/\s*$/, '\n') + yaml.dump([{ insert: [local] }], { lineWidth: -1, noRefs: true })
  const backup = path.join(profile, '.plugin-backups', 'sidenote', stamp, 'cordis.patch.yml')
  const deployment = { commit, hostVersion, pluginVersion: manifest.version, entryId: id, release, backup, clientHash: hash(client), patchHash: hash(next), previousDisabled: row.disabled ?? false, deployedAt: new Date().toISOString() }
  if (!process.argv.includes('--dry-run')) {
    fs.mkdirSync(release, { recursive: true })
    for (const entry of ['lib', 'LICENSE', 'README.md', 'docs/assets/logo.svg']) fs.cpSync(path.join(root, entry), path.join(release, entry), { recursive: true })
    const { devDependencies, scripts, ...runtimeManifest } = manifest
    fs.writeFileSync(path.join(release, 'package.json'), JSON.stringify(runtimeManifest, null, 2) + '\n')
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 })
    replace(original, next)
    fs.writeFileSync(pointer, JSON.stringify(deployment, null, 2) + '\n')
  }
  console.log(JSON.stringify({ ...deployment, dryRun: process.argv.includes('--dry-run') }))
}
