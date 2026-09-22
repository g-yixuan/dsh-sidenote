/**
 * 产物完整性门禁：lib/ 产物里的每个相对路径 import 必须解析到包内的真实
 * 文件，且该文件会被 npm pack 发布（package.json files 白名单内）。
 *
 * 来历（0.4.0/0.4.1 生产事故）：宿主半包对 dsh-llm 的动态 import 被构建
 * 拆成独立 chunk（lib-XXX.js），但 files 白名单不含它——产物里
 * `await import("./lib-DHFe7-hr.js")` 指向一个从未发布的文件，reflow
 * inject 在生产上从未生效（全靠搭车兜底，无用户感知）。
 * 这类「产物引用 ≠ 发布内容」的失配只能靠检查防，不能靠人记。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'

const ROOT = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files: string[] }

/** files 白名单（glob 简化为前缀匹配；我们的形态只有文件与目录前缀）。 */
function publishedFiles(): Set<string> {
  const out = new Set<string>()
  for (const entry of pkg.files) {
    const clean = entry.replace(/\/\*\*$/, '').replace(/\/$/, '')
    if (entry.endsWith('/**') || entry.endsWith('/')) {
      const dir = join(ROOT, clean)
      const walk = (d: string): void => {
        for (const name of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, name.name)
          if (name.isDirectory()) walk(full)
          else out.add(full)
        }
      }
      if (existsSync(dir)) walk(dir)
    } else {
      const full = join(ROOT, clean)
      if (existsSync(full)) out.add(full)
    }
  }
  return out
}

/** 产物内所有相对路径的静态/动态 import 目标（仅 .js/.mjs 相对引用）。 */
function relativeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const targets: string[] = []
  for (const match of source.matchAll(/(?:import|require)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    targets.push(match[1]!)
  }
  return targets
}

describe('构建产物完整性（0.4.0 事故防线）', () => {
  const bundles = ['lib/index.js', 'lib/client.js'].map(f => join(ROOT, f))

  it('产物的相对 import 全部解析到包内文件', () => {
    const published = publishedFiles()
    const missing: string[] = []
    for (const bundle of bundles) {
      for (const rel of relativeImports(bundle)) {
        const target = join(dirname(bundle), rel)
        const candidates = [target, `${target}.js`, join(target, 'index.js')]
        if (!candidates.some(c => published.has(c) || existsSync(c))) {
          missing.push(`${bundle} → ${rel}`)
        }
      }
    }
    expect(missing, `产物引用了不在包内的文件：\n${missing.join('\n')}`).toEqual([])
  })

  it('产物引用的文件都在 npm files 白名单内', () => {
    const published = publishedFiles()
    const unpublished: string[] = []
    for (const bundle of bundles) {
      for (const rel of relativeImports(bundle)) {
        const target = join(dirname(bundle), rel)
        const candidates = [target, `${target}.js`, join(target, 'index.js')]
        const hit = candidates.find(c => existsSync(c))
        if (hit !== undefined && !published.has(hit)) {
          unpublished.push(`${bundle} → ${rel}（存在于磁盘但不会被发布）`)
        }
      }
    }
    expect(unpublished, `产物引用了不会被发布的文件：\n${unpublished.join('\n')}`).toEqual([])
  })
})
