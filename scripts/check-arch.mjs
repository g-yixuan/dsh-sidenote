#!/usr/bin/env node
/**
 * 架构硬门（WI-00，architecture.md 第九节）：纪律的消费者主要是 agent，
 * 软执行必然衰减——本脚本把两条最关键的架构纪律变成 CI 可执行检查。
 *
 * 规则 1（分层）：L0/L1 文件（纯逻辑/store）禁止 react 值导入（import type 放行）。
 * 规则 2（feature 边界）：sidechat/ 与 annotate/ 之间禁止直接互引（共享件应住根部
 *   或 reflow/ 等共享层）；现状唯一遗留例外在 TEMP_ALLOW 显式登记（收敛目标：
 *   format.ts 协议层随 WI-04 迁共享后删除该例外）。
 * 规则 3（行数信号）：超预算文件 CI 警告（非阻断——触发职责审查，判据见
 *   architecture.md 第八节「职责判据 + 行数信号」）。
 *
 * 用法：node scripts/check-arch.mjs（CI 与本地同门）。exit 1 = 规则 1/2 违规。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src/client')

/** L0/L1 判型：纯逻辑与 store 文件（react-free 承诺）。 */
const L01_PATTERNS = [
  /\/model\.ts$/,
  /\/format\.ts$/,
  /\/store\.ts$/,
  /\/reflow\.ts$/,
  /\/locales\.ts$/,
  /\/transcript\.ts$/,
  /\/cards\.ts$/,
  /\/host\/[^/]+\.ts$/, // contracts/probes/markdown 全部 react-free
]

/** feature 互引的存量例外（收敛后删除；新增例外=评审驳回）。 */
const TEMP_ALLOW = [
  // sidechat → annotate/format.ts（wire 协议层住错地方，arch-audit §2.2；
  // WI-04 reflow/ 升格时 format 迁共享层后删本行）
  /sidechat\/.*'\.\.\/annotate\/format\.ts'/,
]

const BUDGETS = [
  { pattern: /\.tsx$/, max: 300, kind: '视图' },
  { pattern: /\.ts$/, max: 400, kind: '逻辑' },
  { pattern: /\.module\.css$/, max: 500, kind: '样式' },
]
/** 已知超预算的技术债（登记豁免；只许减少不许新增）。 */
const BUDGET_DEBT = new Set([
  // 契约镜像面：单一职责（宿主形状登记处），体积即内容——按职责判据豁免。
  'src/client/host/contracts.ts',
  'src/client/annotate/overlay.tsx',
  'src/client/annotate/annotate.module.css',
  'tests/e2e/mount.e2e.ts',
])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.(ts|tsx|css)$/.test(name)) yield path
  }
}

let violations = 0
const warnings = []

for (const dir of [SRC, join(ROOT, 'tests')]) {
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file)
    const src = readFileSync(file, 'utf8')

    // 规则 1：L0/L1 react-free（值导入才拦；import type / import{ type X } 放行）。
    if (/\.ts$/.test(file) && L01_PATTERNS.some(p => p.test(file))) {
      for (const m of src.matchAll(/^import\s+(?!type\b)([^'"]*?)\s+from\s+['"]react['"]/gm)) {
        const clause = m[1]
        // 子句去掉所有 type 修饰成员后为空 = 全类型导入，放行。
        const valueful = clause.replace(/\btype\s+/g, '').replace(/[{}\s,]/g, '')
        if (valueful !== '') {
          console.error(`[L1 违规] ${rel}: L0/L1 文件值导入 react（${m[0].trim()}）`)
          violations += 1
        }
      }
    }

    // 规则 2：feature 互引（例外白名单豁免）。
    if (/(sidechat|annotate)\/[^/]+\.(ts|tsx)$/.test(file)) {
      for (const m of src.matchAll(/from\s+'(\.\.\/(?:sidechat|annotate)\/[^']+)'/g)) {
        const spec = m[1]
        const selfFeature = rel.includes('/sidechat/') ? 'sidechat' : 'annotate'
        if (spec.includes(`/${selfFeature}/`)) continue // 自引不算
        if (TEMP_ALLOW.some(p => p.test(rel + `'${spec}'`.slice(0))) || TEMP_ALLOW.some(p => p.test(`${rel}:${spec}`))) continue
        // 更稳的判定：例外正则匹配的是「文件路径+spec」组合
        if (TEMP_ALLOW.some(p => p.test(rel)) && spec.includes('annotate/format.ts')) continue
        console.error(`[feature 互引] ${rel}: ${spec}（共享件应住根部/reflow 层）`)
        violations += 1
      }
    }

    // 规则 3：行数信号（警告非阻断）。
    if (dir === SRC || rel.includes('e2e')) {
      const lines = src.split('\n').length
      for (const b of BUDGETS) {
        if (b.pattern.test(file) && lines > b.max && !BUDGET_DEBT.has(rel)) {
          warnings.push(`[预算信号] ${rel}: ${lines} 行 > ${b.kind}预算 ${b.max}——触发职责审查（豁免登记在脚本内）`)
        }
      }
    }
  }
}

for (const w of warnings) console.warn(w)
if (violations > 0) {
  console.error(`\n架构硬门：${violations} 处违规（规则 1/2 为阻断项）`)
  process.exit(1)
}
console.log(`架构硬门通过（${warnings.length} 条预算警告，非阻断）`)
