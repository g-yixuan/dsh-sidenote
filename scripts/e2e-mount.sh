#!/usr/bin/env bash
# =============================================================================
# dsh-sidenote 挂载冒烟编排（仿 dsh-better-sidebar scripts/e2e-mount.sh）：
#
#   1. 全新 scratch DSH_HOME（绝不触碰真实 ~/.dsh）+ web profile 模板；
#   2. 官方 CLI 安装本次构建的 npm tarball；
#   3. 伪造一个含已完成 turn 的会话 jsonl（scripts/seed-session.mjs），
#      使 fork 路径无需模型凭证即可验证；
#   4. 启动真实 `dsh web --port 0`（keyless），Playwright 无头渲染断言。
#
# 用法：bash scripts/e2e-mount.sh [--grep <playwright-filter>]
# 环境变量：DSH_CMD / TARBALL / PORT / DSH_HOME_BASE / KEEP_HOME（同上游脚本）。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DSH_CMD="${DSH_CMD:-dsh}"
PORT="${PORT:-0}"
TARBALL="${TARBALL:-}"
GREP_FILTER=""
if [ "${1:-}" = "--grep" ]; then GREP_FILTER="${2:?--grep 需要参数}"; fi

say()  { printf '\033[32m[e2e-mount]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[e2e-mount]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[e2e-mount]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "未找到 node"
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm"

# DSH_CMD 允许是带参数的命令串（矩阵档钉版：`npx -y --package
# @deepseek-ai/dsh@0.1.2-rc.1 dsh`）。command -v 对多词串会误判缺失；
# 回退会丢掉版本钉、静默改测 latest，所以只校验
# 首个词可执行，参数原样透传给后续 `$DSH_CMD …` 调用；缺失即失败。
DSH_BIN="${DSH_CMD%% *}"
command -v "$DSH_BIN" >/dev/null 2>&1 || die "未找到 $DSH_BIN；不会回退到另一个宿主版本"

if [ -z "$TARBALL" ]; then
  # 按 package.json 版本精确选 tarball——仓库根可能残留历史版本的
  # dsh-sidenote-*.tgz，字典序 head -1 会选中旧版（0.1.1 排在 0.2.0 前），
  # 静默测了旧构建（2026-09-07 实踩）。
  VERSION="$(node -p "require('$ROOT/package.json').version")"
  TARBALL="$ROOT/dsh-sidenote-$VERSION.tgz"
fi
[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || die "找不到 tarball——先运行 pnpm build && pnpm pack"
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
say "tarball: $TARBALL"

SCRATCH="${DSH_HOME_BASE:-$(mktemp -d /tmp/dsh-sidenote-e2e.XXXXXX)}"
export DSH_HOME="$SCRATCH/home"
WORKSPACE_DIR="$SCRATCH/workspace"
WEB_LOG="$SCRATCH/web.log"
mkdir -p "$DSH_HOME/profiles/web" "$WORKSPACE_DIR"
say "scratch home: ${DSH_HOME}"

SERVER_PID=""
cleanup() {
  local code=$?
  # A recovery test can replace the host. The fixture records the actual Node
  # PID even when DSH_CMD starts through an npx wrapper.
  if [ -f "$SCRATCH/server.pid" ]; then
    local active_pid
    active_pid="$(cat "$SCRATCH/server.pid")"
    if [[ "$active_pid" =~ ^[0-9]+$ ]] && [ "$active_pid" -gt 1 ]; then kill "$active_pid" 2>/dev/null || true; fi
  fi
  if [ -f "$SCRATCH/host-inventory.json" ]; then
    if ! node - "$SCRATCH/host-inventory.json" "$SCRATCH/runtime-inventory.json" <<'JS'
const fs = require('node:fs')
const [file, runtimeFile] = process.argv.slice(2)
const inventory = JSON.parse(fs.readFileSync(file, 'utf8'))
if (fs.existsSync(runtimeFile)) Object.assign(inventory, JSON.parse(fs.readFileSync(runtimeFile, 'utf8')))
fs.writeFileSync(file, JSON.stringify(inventory, null, 2) + '\n')
JS
    then code=1; fi
    mkdir -p "$ROOT/test-results"
    cp "$SCRATCH/host-inventory.json" "$ROOT/test-results/host-inventory.json"
  fi
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ "$code" -ne 0 ] && [ -f "$WEB_LOG" ]; then
    mkdir -p "$ROOT/test-results"
    sed -E 's/(\?token=)[A-Za-z0-9_-]+/\1[redacted]/g' "$WEB_LOG" > "$ROOT/test-results/host-web.log"
    cat "$ROOT/test-results/host-web.log" >&2
  fi
  if [ -z "${KEEP_HOME:-}" ]; then
    rm -rf "$SCRATCH"
  else
    warn "KEEP_HOME 已设置，保留 $SCRATCH"
  fi
  exit "$code"
}
trap cleanup EXIT

# 步骤 1：scratch profile 模板（pnpm 11 strict-dep-builds 护栏同上游）。
# patchReload 必须显式 "startup"：自定义 profile 缺省是 "live"，会拉起
# Cordis HMR 服务做补丁热监听——无头 e2e 不需要，且在精简运行时下直接
# 启动失败（dsh-app-boot watchUserPatches）。
PROFILE_DIR="$DSH_HOME/profiles/web"
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
      "patchReload": "startup"
    }
  }
}
EOF
# Every admitted host uses the same native runtime.
DSH_VERSION="$($DSH_CMD --version)"
if [ -n "${DSH_EXPECTED_VERSION:-}" ] && [ "$DSH_VERSION" != "$DSH_EXPECTED_VERSION" ]; then
  die "请求宿主 $DSH_EXPECTED_VERSION，实际 CLI $DSH_VERSION"
fi
say "实际 CLI：$DSH_VERSION"
printf '[]\n' > "$PROFILE_DIR/cordis.patch.yml"
cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'EOF'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

allowBuilds:
  node-pty: true
  protobufjs: true
  koffi: true

minimumReleaseAgeExclude:
  - dsh-better-sidebar
  - dsh-sidenote
EOF

BS_VERSION="${BS_VERSION:-none}"
[ "$BS_VERSION" = "none" ] || die "This branch validates native hosts only; legacy hosts pin plugin 0.6.5"
say "安装本插件 tarball..."
$DSH_CMD plugin --profile web add "file:$TARBALL"

node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  const required = ["dsh-sidenote"];
  const missing = required.filter((b) => !bundles.includes(b));
  if (missing.length) { console.error("挂载未注册:", missing.join(", ")); process.exit(1); }
' "$PROFILE_DIR/package.json" "$BS_VERSION"
say "挂载已注册（BS_VERSION=${BS_VERSION}）"

if [ -n "${DSH_E2E_CAPABILITY_FAULT:-}" ]; then
  cp -R "$ROOT/tests/fixtures/capability-fault" "$SCRATCH/capability-fault"
  $DSH_CMD plugin --profile web add "file:$SCRATCH/capability-fault"
fi

# 只读 inventory fixture 从真实 host registry 的 bundle 路径读取版本。
# 不从本仓 devDependencies 或 CLI 版本推断运行组件版本。
# Outside the repository package boundary: this loose module has no dsh.client.
cp "$SCRIPT_DIR/../tests/e2e/runtime-inventory.mjs" "$SCRATCH/runtime-inventory.mjs"
cp "$SCRIPT_DIR/../tests/e2e/controlled-model.mjs" "$SCRATCH/controlled-model.mjs"
cp "$SCRIPT_DIR/../tests/e2e/retained-compaction.mjs" "$SCRATCH/retained-compaction.mjs"
node - "$PROFILE_DIR/cordis.patch.yml" "$SCRATCH/runtime-inventory.mjs" "$SCRATCH/runtime-inventory.json" <<'JS'
const fs = require('node:fs')
const [file, fixture, output] = process.argv.slice(2)
const old = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file, (old.trim() === '[]' ? '' : old) + '\n- insert:\n  - id: sidenote-e2e-inventory\n    name: ' + JSON.stringify(fixture) + '\n    config:\n      output: ' + JSON.stringify(output) + '\n      pidFile: ' + JSON.stringify(require('node:path').join(require('node:path').dirname(output), 'server.pid')) + '\n')
fs.appendFileSync(file, '- insert:\n  - id: sidenote-e2e-model\n    name: ' + JSON.stringify(require('node:path').join(require('node:path').dirname(fixture), 'controlled-model.mjs')) + '\n')
fs.appendFileSync(file, '- insert:\n  - id: sidenote-e2e-retained-compaction\n    name: ' + JSON.stringify(require('node:path').join(require('node:path').dirname(fixture), 'retained-compaction.mjs')) + '\n')
JS

# Optional real-provider lane. Only the server inherits the credential; the
# profile stores its environment reference and Playwright never receives it.
if [ -n "${DSH_E2E_REAL_KEY_FILE:-}" ]; then
  [ -r "$DSH_E2E_REAL_KEY_FILE" ] || die "Cannot read real-provider key file"
  IFS= read -r DSH_E2E_OFFICIAL_KEY < "$DSH_E2E_REAL_KEY_FILE" || [ -n "${DSH_E2E_OFFICIAL_KEY:-}" ]
  [ -n "${DSH_E2E_OFFICIAL_KEY:-}" ] || die "Empty real-provider key file"
  export DSH_E2E_OFFICIAL_KEY DSH_E2E_REAL_MODEL=1
fi
if [ -n "${DSH_E2E_REAL_KEY_FILE:-}${DSH_E2E_ACCOUNT_MODEL:-}" ]; then
  cp "$ROOT/tests/e2e/official-wire.mjs" "$SCRATCH/official-wire.mjs"
  node - "$PROFILE_DIR/cordis.patch.yml" "$SCRATCH" <<'JS'
const fs = require('node:fs')
const [file, scratch] = process.argv.slice(2)
fs.appendFileSync(file, '\n- insert:\n  - id: sidenote-e2e-official-wire\n    name: ' + JSON.stringify(scratch + '/official-wire.mjs') + '\n    config:\n      output: ' + JSON.stringify(scratch + '/official-wire.json') + '\n')
JS
fi
if [ -n "${DSH_E2E_REAL_KEY_FILE:-}" ]; then
  cat >> "$PROFILE_DIR/cordis.patch.yml" <<'EOF'
- id: llm-pi-ai
  config:
    providers:
      sidenote-official:
        apiKeyEnv: DSH_E2E_OFFICIAL_KEY
        api: openai-completions
        baseURL: https://api.deepseek.com
        reasoning: off
        compat:
          thinkingFormat: deepseek
          supportsReasoningEffort: true
          requiresReasoningContentOnAssistantMessages: true
        models:
          - id: deepseek-flash
            name: DeepSeek Flash (official E2E)
            input: [text, image]
            contextWindow: 32768
            maxTokens: 2048
            reasoningEfforts:
              off: null
              low: low
              high: high
              xhigh: max
EOF
fi
mkdir -p "$ROOT/test-results"
node - "$SCRATCH/host-inventory.json" "${DSH_EXPECTED_VERSION:-}" "$DSH_VERSION" "$BS_VERSION" "$ROOT/package.json" "$ROOT/lib/client.js" <<'JS'
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const [file, expected, actualHost, bs, manifest, client] = process.argv.slice(2)
fs.writeFileSync(file, JSON.stringify({ requestedHost: expected || null, actualHost, requestedBetterSidebar: bs === 'none' ? null : bs, requestedPlugin: JSON.parse(fs.readFileSync(manifest, 'utf8')).version, expectedClientSha256: createHash('sha256').update(fs.readFileSync(client)).digest('hex') }, null, 2) + '\n')
JS

# 步骤 3：伪造含已完成 turn 的会话（fork 路径无需模型凭证）
SEED_SESSION_ID="$(node "$SCRIPT_DIR/seed-session.mjs" "$DSH_HOME" "$WORKSPACE_DIR")"
say "伪造会话: $SEED_SESSION_ID"

# 步骤 4：启动 dsh web
say "启动 dsh web（port=${PORT}）..."
# --no-open：宿主默认会调起系统默认浏览器（openBrowser=true）——验证用实例
# 绝不能弹用户的真实浏览器窗口。
$DSH_CMD web --port "$PORT" --no-open > "$WEB_LOG" 2>&1 &
SERVER_PID=$!
unset DSH_E2E_OFFICIAL_KEY

# 就绪行解析：DSH 0.1.2+ 打印的是带一次性 token 的鉴权 URL
# （`dsh web: http://127.0.0.1:<port>/?token=<43字符>`，token 换浏览器
# cookie 后才能访问页面与 /api；干净 URL 只会得到 401）；0.1.1-rc.x 及
# 更早是裸 origin。正则必须延伸到空白（`[^ ]*`）——在 `/` 或端口处截断
# 会丢掉 token，0.1.2 宿主上的整条 lane 都会挂在首屏 401（同
# dsh-better-sidebar scripts/e2e-mount.sh 的已验证写法）。
URL=""
for _ in $(seq 1 120); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== dsh web 提前退出，日志尾部 ===" >&2
    tail -30 "$WEB_LOG" | sed -E 's/(\?token=)[A-Za-z0-9_-]+/\1[redacted]/g' >&2 || true
    exit 1
  fi
  if URL="$(grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+[^ ]*' "$WEB_LOG" | head -1 | awk '{print $3}')" && [ -n "$URL" ]; then
    break
  fi
  sleep 1
done
[ -n "$URL" ] || { echo "=== 120s 内未等到 dsh web 就绪，日志尾部 ===" >&2; tail -40 "$WEB_LOG" | sed -E 's/(\?token=)[A-Za-z0-9_-]+/\1[redacted]/g' >&2 || true; exit 1; }
say "dsh web 就绪：${URL%%\?*}（pid ${SERVER_PID}）"

# 工作区注册（workspace.create）不再在这里 curl：0.1.2 起宿主要求
# ① 先用启动 token 换 cookie、② 点式端点改为斜杠 `/api/workspace/create`
# + `{args:{request:...}}` 包装——shell 里做双方言探测 + token 交换太脆，
# 统一移进 tests/e2e/host.ts 的 createHostApi()/hostRpc()（lane beforeAll
# 调用），0.1.1/0.1.2 双方言自动选择。

# Verify the mounted artifact before exercising UI; a reused file dependency
# can otherwise keep an older tarball with the same package version.
assert_inventory() {
node - "$SCRATCH/host-inventory.json" "$SCRATCH/runtime-inventory.json" <<'JS'
const fs = require('node:fs')
const [file, runtimeFile] = process.argv.slice(2)
const inventory = JSON.parse(fs.readFileSync(file, 'utf8'))
Object.assign(inventory, JSON.parse(fs.readFileSync(runtimeFile, 'utf8')))
for (const id of ['dsh-sidenote', '@deepseek-ai/dsh-client-ui-conversation']) {
  if (!inventory.runtimePackages[id]?.version) throw new Error('Active host version missing: ' + id)
}
if (inventory.runtimePackages['dsh-sidenote'].version !== inventory.requestedPlugin) throw new Error('Mounted plugin version mismatch')
if (inventory.runtimePackages['dsh-sidenote'].clientSha256 !== inventory.expectedClientSha256) throw new Error('Mounted plugin is not the current build')
if (inventory.requestedBetterSidebar !== null && inventory.runtimePackages['dsh-better-sidebar']?.version !== inventory.requestedBetterSidebar) throw new Error('Mounted better-sidebar version mismatch')
fs.writeFileSync(file, JSON.stringify(inventory, null, 2) + '\n')
JS

}
assert_inventory

# 步骤 5：Playwright 无头渲染 lane（无-BS 档跑直连冒烟，BS 档跑全量 journey）
say "运行 Playwright 无头渲染 lane..."
DSH_E2E_URL="$URL" DSH_E2E_WORKSPACE="$WORKSPACE_DIR" DSH_E2E_SEED_SESSION="$SEED_SESSION_ID" DSH_E2E_HOME="$DSH_HOME" \
DSH_E2E_HOST_COMMAND="$DSH_CMD" DSH_E2E_SERVER_PID_FILE="$SCRATCH/server.pid" DSH_E2E_SERVER_LOG="$WEB_LOG" \
  pnpm exec playwright test mount-direct.e2e.ts annotations.e2e.ts core.e2e.ts running.e2e.ts side-selection.e2e.ts diagnostics.e2e.ts visibility.e2e.ts parity.e2e.ts interaction.e2e.ts context-reading.e2e.ts context-lifecycle.e2e.ts unified-context.e2e.ts recovery.e2e.ts review-boundaries.e2e.ts context-submission.e2e.ts compaction.e2e.ts official-model.e2e.ts ${GREP_FILTER:+--grep "$GREP_FILTER"}

assert_inventory

say "通过：真实宿主 journey；版本记录在 test-results/host-inventory.json"
