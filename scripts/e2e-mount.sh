#!/usr/bin/env bash
# =============================================================================
# dsh-sidechat 挂载冒烟编排（仿 dsh-better-sidebar scripts/e2e-mount.sh）：
#
#   1. 全新 scratch DSH_HOME（绝不触碰真实 ~/.dsh）+ web profile 模板；
#   2. 官方 CLI 安装 npm 版 dsh-better-sidebar（本插件的硬依赖）与本插件
#      tarball（file:<tgz>）；
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

if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
  if command -v npx >/dev/null 2>&1; then
    say "PATH 上无 $DSH_CMD，回退 npx -y --package @deepseek-ai/dsh"
    DSH_CMD="npx -y --package @deepseek-ai/dsh dsh"
  else
    die "未找到 $DSH_CMD 或 npx"
  fi
fi

if [ -z "$TARBALL" ]; then
  TARBALL="$(ls "$ROOT"/dsh-sidechat-*.tgz 2>/dev/null | head -1 || true)"
fi
[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || die "找不到 tarball——先运行 pnpm build && pnpm pack"
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
say "tarball: $TARBALL"

SCRATCH="${DSH_HOME_BASE:-$(mktemp -d /tmp/dsh-sidechat-e2e.XXXXXX)}"
export DSH_HOME="$SCRATCH/home"
WORKSPACE_DIR="$SCRATCH/workspace"
WEB_LOG="$SCRATCH/web.log"
mkdir -p "$DSH_HOME/profiles/web" "$WORKSPACE_DIR"
say "scratch home: ${DSH_HOME}"

SERVER_PID=""
cleanup() {
  local code=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -z "${KEEP_HOME:-}" ]; then
    rm -rf "$SCRATCH"
  else
    warn "KEEP_HOME 已设置，保留 $SCRATCH"
  fi
  exit "$code"
}
trap cleanup EXIT

# 步骤 1：scratch profile 模板（pnpm 11 strict-dep-builds 护栏同上游）
PROFILE_DIR="$DSH_HOME/profiles/web"
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    }
  }
}
EOF
printf '[]\n' > "$PROFILE_DIR/cordis.patch.yml"
cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'EOF'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

allowBuilds:
  node-pty: true
  protobufjs: true

minimumReleaseAgeExclude:
  - dsh-better-sidebar
  - dsh-sidechat
EOF

# 步骤 2：先装硬依赖 better-sidebar（版本钉住：缺省 0.12.3 = 线上 profile 同版；
# BS_VERSION 覆盖可做前向兼容验证，如 BS_VERSION=0.13.0）
BS_VERSION="${BS_VERSION:-0.12.3}"
say "安装 dsh-better-sidebar@${BS_VERSION}..."
$DSH_CMD plugin --profile web add "dsh-better-sidebar@${BS_VERSION}"
say "安装本插件 tarball..."
$DSH_CMD plugin --profile web add "file:$TARBALL"

node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  const missing = ["dsh-better-sidebar", "dsh-sidechat"].filter((b) => !bundles.includes(b));
  if (missing.length) { console.error("挂载未注册:", missing.join(", ")); process.exit(1); }
' "$PROFILE_DIR/package.json"
say "挂载已注册：dsh-better-sidebar + dsh-sidechat"

# 步骤 3：伪造含已完成 turn 的会话（fork 路径无需模型凭证）
SEED_SESSION_ID="$(node "$SCRIPT_DIR/seed-session.mjs" "$DSH_HOME" "$WORKSPACE_DIR")"
say "伪造会话: $SEED_SESSION_ID"

# 步骤 4：启动 dsh web
say "启动 dsh web（port=${PORT}）..."
$DSH_CMD web --port "$PORT" > "$WEB_LOG" 2>&1 &
SERVER_PID=$!

URL=""
for _ in $(seq 1 120); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== dsh web 提前退出，日志尾部 ===" >&2
    tail -30 "$WEB_LOG" >&2 || true
    exit 1
  fi
  if URL="$(grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+' "$WEB_LOG" | head -1 | awk '{print $3}')" && [ -n "$URL" ]; then
    break
  fi
  sleep 1
done
[ -n "$URL" ] || { echo "=== 120s 内未等到 dsh web 就绪，日志尾部 ===" >&2; tail -40 "$WEB_LOG" >&2 || true; exit 1; }
say "dsh web 就绪：${URL}（pid ${SERVER_PID}）"

# 步骤 4b：注册 scratch 工作区（伪造会话的 cwd 挂在它下面才会进 GUI 列表）
curl -s "$URL/api/workspace.create" -X POST -H 'content-type: application/json' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"e2e-workspace\",\"method\":\"workspace.create\",\"payload\":{\"path\":\"$WORKSPACE_DIR\"}}" \
  | grep -q '"ok":true' && say "工作区已注册: $WORKSPACE_DIR" || warn "workspace.create 未确认（继续，测试内会再试）"

# 步骤 5：Playwright 无头渲染 lane
say "运行 Playwright 无头渲染 lane..."
DSH_E2E_URL="$URL" DSH_E2E_WORKSPACE="$WORKSPACE_DIR" DSH_E2E_SEED_SESSION="$SEED_SESSION_ID" \
  pnpm exec playwright test ${GREP_FILTER:+--grep "$GREP_FILTER"}

say "通过：dsh-sidechat 挂载到真实 DSH 后无头渲染未崩溃"
