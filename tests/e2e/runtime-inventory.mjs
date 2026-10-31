/** Read-only test instrumentation: versions come from the host's active bundle paths. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

export const name = 'sidenote-e2e-inventory'
export const inject = ['clientModules']

function owningManifest(file, expected) {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (pkg.name === expected) return { name: pkg.name, version: pkg.version }
    }
    if (dir === parse(dir).root) return undefined
  }
}

export function apply(ctx, config) {
  if (config.pidFile) writeFileSync(config.pidFile, String(process.pid))
  const modules = ctx.clientModules
  const collect = () => {
    const graph = modules.graph()
    const runtimePackages = {}
    const anchors = [ctx.baseUrl]
    for (const entry of graph.entries) {
      const file = modules.clientPath(entry.id)
      const pkg = file === undefined ? undefined : owningManifest(file, entry.id)
      runtimePackages[entry.id] = { version: pkg?.version ?? null, revision: entry.rev, source: pkg ? 'active-client-bundle' : 'unknown' }
      if (entry.id === 'dsh-sidenote' && file !== undefined) {
        runtimePackages[entry.id].clientSha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
      }
      if (file !== undefined) anchors.push(pathToFileURL(file).href)
    }
    // Static frontend components and host APIs may not have their own boot row.
    const packages = ctx.get('pluginPackages')
    for (const component of ['dsh-base', 'dsh-web-app', 'dsh-client-runtime', 'dsh-sdk-client', 'dsh-client-ui-primitives', 'dsh-client-ui-sidebar-right', 'dsh-api-session-controller']) {
      const id = '@deepseek-ai/' + component
      if (runtimePackages[id]) continue
      let identity
      for (const anchor of anchors) {
        const manifest = packages?.packageOf(id, anchor)?.manifestPath
        if (manifest !== undefined) {
          const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
          identity = { name: pkg.name, version: pkg.version }
          break
        }
        if (packages !== undefined) continue
        for (const lookup of createRequire(anchor).resolve.paths(id) ?? []) {
          const manifest = join(lookup, id, 'package.json')
          if (!existsSync(manifest)) continue
          const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
          identity = { name: pkg.name, version: pkg.version }
          break
        }
        if (identity) break
      }
      runtimePackages[id] = { version: identity?.version ?? null, source: identity ? 'resolved-from-active-host' : 'unknown' }
    }
    // Deliberately excludes file paths, config, user text and authentication data.
    writeFileSync(config.output, JSON.stringify({ bootRevision: graph.rev, runtimePackages }, null, 2) + '\n')
  }
  ctx.effect(() => {
    collect()
    return modules.onGraphChanged(collect)
  })
}
