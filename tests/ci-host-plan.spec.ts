import { describe, expect, it, vi } from 'vitest'

const script = new URL('../scripts/ci-host-plan.mjs', import.meta.url).href
const { planHostValidation, validationEnvironment } = await import(script)
const now = Date.parse('2026-11-09T01:00:00Z')

function fixture(options: {
  eventName?: string; ref?: string; files?: string; before?: object; after?: object;
  sourceTree?: string; sourceMode?: string; sourceEnvironment?: string; ci?: string; gate?: string; step?: string;
  conclusion?: string; updated?: string; head?: string; merged?: boolean; apiError?: boolean;
  baseRun?: boolean; baseFailed?: boolean;
} = {}) {
  const eventName = options.eventName ?? 'pull_request'
  const git = vi.fn((...args: string[]) => {
    const command = args.join(' ')
    if (command === 'rev-parse HEAD') return 'merged-commit'
    if (command === 'rev-parse HEAD^{tree}') return 'merged-tree'
    if (command === 'rev-parse base^{tree}') return 'base-tree'
    if (command === 'diff --name-only base HEAD') return options.files ?? 'package.json'
    if (command === 'show base:package.json') return JSON.stringify(options.before ?? { name: 'plugin', version: '0.8.4' })
    if (command === 'show HEAD:package.json') return JSON.stringify(options.after ?? { name: 'plugin', version: '0.8.5' })
    throw new Error(`Unexpected git command: ${command}`)
  })
  const api = vi.fn(async (path: string) => {
    if (options.apiError) throw new Error('GitHub unavailable')
    if (path.startsWith('commits/')) return options.merged === false ? [] : [{
      merged_at: '2026-11-09T00:45:00Z', merge_commit_sha: path.split('/')[1],
      base: { ref: 'main' }, head: { sha: 'pr-head' },
    }]
    if (path.startsWith('actions/workflows/')) {
      const sha = new URLSearchParams(path.split('?')[1]).get('head_sha')
      return { workflow_runs: options.baseRun === false && sha === 'base' ? [] : [{
        id: 42, head_sha: options.head ?? sha, status: 'completed', conclusion: options.baseFailed && sha === 'base' ? 'failure' : options.conclusion ?? 'success',
        path: '.github/workflows/ci.yml', updated_at: options.updated ?? '2026-11-09T00:30:00Z',
      }] }
    }
    if (path === 'actions/runs/42/jobs?per_page=100') return { jobs: [
      { name: 'ci', conclusion: options.ci ?? 'success' },
      { name: 'host-compatibility', conclusion: options.gate ?? 'success', steps: [{
        name: `Validated ${options.sourceMode ?? 'full'} tree ${options.sourceTree ?? (eventName === 'push' ? 'merged-tree' : 'base-tree')} environment ${options.sourceEnvironment ?? 'node24-linux-image1'}`,
        conclusion: options.step ?? 'success',
      }] },
    ] }
    throw new Error(`Unexpected API request: ${path}`)
  })
  return {
    eventName, ref: options.ref ?? 'refs/heads/main', environment: 'node24-linux-image1', now, git, api,
    event: { after: 'merged-commit', pull_request: { base: { sha: 'base', ref: 'main' } } },
  }
}

describe('host validation plan', () => {
  const runtime = { nodeVersion: 'v24.22.2', platform: 'linux', arch: 'x64', imageOS: 'ubuntu26', imageVersion: '20261111.196.1' }

  it.each(['pull_request', 'push'])('reuses verified content across runner image rebuilds (%s)', async eventName => {
    const sourceEnvironment = validationEnvironment(runtime)
    const input = fixture({ eventName, sourceEnvironment })
    const environment = validationEnvironment({ ...runtime, imageVersion: '20261101.186.1' })
    expect(await planHostValidation({ ...input, environment })).toMatchObject({ mode: 'smoke' })
  })

  it.each([
    { nodeVersion: 'v24.23.0' }, { platform: 'darwin' }, { arch: 'arm64' }, { imageOS: 'ubuntu24' },
  ])('requires full journeys after an actual runtime change: %j', async difference => {
    const input = fixture({ sourceEnvironment: validationEnvironment(runtime) })
    const environment = validationEnvironment({ ...runtime, ...difference })
    expect(await planHostValidation({ ...input, environment })).toMatchObject({ mode: 'full' })
  })

  it.each(['full', 'smoke'])('uses release smoke only on a verified version-only change (%s base)', async sourceMode => {
    const input = fixture({ sourceMode })
    expect(await planHostValidation(input)).toMatchObject({ mode: 'smoke', tree: 'merged-tree', source: { run: 42, tree: 'base-tree' } })
  })

  it('can verify the base through its merged PR while main CI is still running', async () => {
    expect(await planHostValidation(fixture({ baseRun: false }))).toMatchObject({ mode: 'smoke', source: { commit: 'pr-head' } })
  })

  it.each([
    { files: 'src/index.ts' },
    { files: 'package.json\npnpm-lock.yaml' },
    { after: { name: 'different-plugin', version: '0.8.5' } },
    { after: { name: 'plugin', version: '0.8.4' } },
  ])('keeps full coverage for changes beyond the version: %j', async options => {
    const input = fixture(options)
    expect(await planHostValidation(input)).toMatchObject({ mode: 'full' })
    expect(input.api).not.toHaveBeenCalled()
  })

  it.each([
    { sourceTree: 'different-tree' }, { sourceMode: 'unknown' }, { sourceEnvironment: 'different-runner-os' }, { ci: 'failure' },
    { gate: 'skipped' }, { gate: 'cancelled' }, { step: 'skipped' }, { conclusion: 'cancelled' },
    { updated: '2026-11-07T00:00:00Z' }, { updated: 'invalid' }, { updated: '2026-11-10T00:00:00Z' },
    { head: 'different-head' }, { baseRun: false, merged: false }, { apiError: true },
  ])('falls back to full journeys when evidence cannot prove success: %j', async options => {
    expect(await planHostValidation(fixture(options))).toMatchObject({ mode: 'full' })
  })

  it('matches the actual PR merge checkout tree after a squash or merge', async () => {
    expect(await planHostValidation(fixture({ eventName: 'push' }))).toMatchObject({
      mode: 'smoke', source: { commit: 'pr-head', tree: 'merged-tree' },
    })
  })

  it.each([{ merged: false }, { sourceTree: 'head-tree-without-main-changes' }, { apiError: true }])('requires proof of the merged content on main: %j', async options => {
    expect(await planHostValidation(fixture({ ...options, eventName: 'push' }))).toMatchObject({ mode: 'full' })
  })

  it.each(['schedule', 'workflow_dispatch'])('keeps %s runs full and independent of old results', async eventName => {
    const input = fixture({ eventName })
    expect(await planHostValidation(input)).toMatchObject({ mode: 'full' })
    expect(input.api).not.toHaveBeenCalled()
  })

  it('does not reuse results from an unknown runner OS', async () => {
    expect(validationEnvironment({ ...runtime, imageOS: undefined })).toBeNull()
    const input = { ...fixture(), environment: null }
    expect(await planHostValidation(input)).toMatchObject({ mode: 'full' })
    expect(input.api).not.toHaveBeenCalled()
  })

  it('does not reuse an older success when the latest rerun failed', async () => {
    const input = fixture({ eventName: 'push' })
    const original = input.api.getMockImplementation()!
    input.api.mockImplementation(async path => {
      const response = await original(path)
      if ('workflow_runs' in response) {
        const success = response.workflow_runs![0]!
        return { workflow_runs: [{ ...success, id: 43, conclusion: 'failure' }, success] }
      }
      return response
    })
    expect(await planHostValidation(input)).toMatchObject({ mode: 'full' })
    expect(input.api).not.toHaveBeenCalledWith('actions/runs/42/jobs?per_page=100')
  })

  it('does not bypass a failed main run with a green PR when checking a release base', async () => {
    const input = fixture({ baseFailed: true })
    expect(await planHostValidation(input)).toMatchObject({ mode: 'full' })
    expect(input.api).not.toHaveBeenCalledWith('commits/base/pulls?per_page=100')
  })
})
