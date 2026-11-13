#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Hosted runners can alternate image builds within the same OS series.
export function validationEnvironment({ nodeVersion, platform, arch, imageOS }) {
  if (!imageOS) return null
  return createHash('sha256').update(JSON.stringify([nodeVersion, platform, arch, imageOS])).digest('hex')
}

/** Reuse only a successful run's explicit record of the tree it actually tested. */
export async function planHostValidation({ eventName, event, ref, environment, git, api, now = Date.now() }) {
  const commit = git('rev-parse', 'HEAD').trim()
  const tree = git('rev-parse', 'HEAD^{tree}').trim()
  const full = { mode: 'full', commit, tree, environment, reason: 'No matching recent validation; run every host journey.' }
  if (!environment) return { ...full, reason: 'Runner OS is unknown; run every host journey.' }
  async function validatedRun(sha, expectedTree) {
    const { workflow_runs: runs } = await api(`actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=10`)
    // A failed or unfinished rerun must not resurrect an older green result.
    const run = runs.find(candidate => candidate.head_sha === sha && candidate.path === '.github/workflows/ci.yml')
    if (!run) return
    if (run.status === 'completed' && run.conclusion !== 'success') throw new Error('Latest validation failed or was cancelled')
    const age = now - Date.parse(run.updated_at)
    if (run.status !== 'completed' || run.conclusion !== 'success'
      || !Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) return
    const { jobs } = await api(`actions/runs/${run.id}/jobs?per_page=100`)
    const ci = jobs.find(job => job.name === 'ci')
    const gate = jobs.find(job => job.name === 'host-compatibility')
    if (ci?.conclusion !== 'success' || gate?.conclusion !== 'success') throw new Error('Required validation gates did not succeed')
    if (gate.steps.some(step => step.conclusion === 'success'
      && ['full', 'smoke'].some(mode => step.name === `Validated ${mode} tree ${expectedTree} environment ${environment}`))) {
      return { run: run.id, commit: sha, tree: expectedTree }
    }
  }
  async function mergedPRValidation(sha, expectedTree) {
    const pulls = await api(`commits/${sha}/pulls?per_page=100`)
    for (const pull of pulls) {
      if (!pull.merged_at || pull.merge_commit_sha !== sha || pull.base.ref !== 'main') continue
      const source = await validatedRun(pull.head.sha, expectedTree)
      if (source) return source
    }
  }
  try {
    if (eventName === 'pull_request' && event.pull_request.base.ref === 'main') {
      const base = event.pull_request.base.sha
      const files = git('diff', '--name-only', base, 'HEAD').trim()
      if (files !== 'package.json') return full
      const before = JSON.parse(git('show', `${base}:package.json`))
      const after = JSON.parse(git('show', 'HEAD:package.json'))
      const changedVersion = typeof after.version === 'string' && after.version !== before.version
      delete before.version
      delete after.version
      if (!changedVersion || JSON.stringify(before) !== JSON.stringify(after)) return full
      const baseTree = git('rev-parse', `${base}^{tree}`).trim()
      const source = await validatedRun(base, baseTree) ?? await mergedPRValidation(base, baseTree)
      if (source) return { ...full, mode: 'smoke', reason: 'Only package.json version changed on a validated base.', source }
    }
    if (eventName === 'push' && ref === 'refs/heads/main' && event.after === commit) {
      const source = await mergedPRValidation(commit, tree)
      if (source) return { ...full, mode: 'smoke', reason: 'Merged tree exactly matches the validated PR merge result.', source }
    }
  } catch {
    // API errors, old workflows without a tree record, or missing evidence must
    // never turn a required check into a skip or make a release wait for proof.
    return { ...full, reason: 'Validation evidence unavailable; run every host journey.' }
  }
  return full
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const environmentInfo = {
    nodeVersion: process.version, platform: process.platform, arch: process.arch,
    imageOS: process.env.ImageOS, imageVersion: process.env.ImageVersion,
  }
  const plan = await planHostValidation({
    eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    ref: process.env.GITHUB_REF,
    environment: validationEnvironment(environmentInfo),
    git: (...args) => execFileSync('git', args, { encoding: 'utf8' }),
    api: async path => JSON.parse(execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/${path}`],
      { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] })),
  })
  const report = { ...plan, runtime: environmentInfo }
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/host-plan.json', `${JSON.stringify(report, null, 2)}\n`)
  appendFileSync(process.env.GITHUB_OUTPUT, `host-mode=${plan.mode}\ntree=${plan.tree}\nenvironment=${plan.environment}\n`)
  const source = plan.source ? `\nEvidence: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${plan.source.run}\n` : ''
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Host validation: ${plan.mode}\n\n${plan.reason}\n\nTested tree: \`${plan.tree}\`\n\nRuntime: ${process.version} / ${process.platform} / ${process.arch} / ${environmentInfo.imageOS ?? 'unknown'}\n\nRunner image build (recorded only): ${environmentInfo.imageVersion ?? 'unknown'}\n${source}`)
  console.log(JSON.stringify(report, null, 2))
}
