#!/usr/bin/env bash
# 截图/录屏用的常驻 scratch 环境：与 e2e-mount.sh 同构但不跑测试、不清理，
# 直到收到信号。用法：bash scripts/capture-env.sh  →  stdout 打印就绪 URL。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_CMD="${DSH_CMD:-dsh}"
BS_VERSION="${BS_VERSION:-0.16.1}"
PORT="${PORT:-4177}"
TARBALL="${TARBALL:-}"
if [ -z "$TARBALL" ]; then
  # 按 package.json 版本精确选（字典序 head -1 会让残留旧版压过新版）。
  TARBALL="$SCRIPT_DIR/../dsh-sidenote-$(node -p "require('$SCRIPT_DIR/../package.json').version").tgz"
fi
[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || { echo "找不到 tarball——先 pnpm build && pnpm pack" >&2; exit 1; }
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

SCRATCH="$(mktemp -d /tmp/dsh-sidenote-capture.XXXXXX)"
export DSH_HOME="$SCRATCH/home"
WORKSPACE_DIR="$SCRATCH/workspace"
mkdir -p "$DSH_HOME/profiles/web" "$WORKSPACE_DIR"
echo "scratch: $SCRATCH"

PROFILE_DIR="$DSH_HOME/profiles/web"
cat > "$PROFILE_DIR/package.json" <<'EOF'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
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
  - dsh-sidenote
EOF

$DSH_CMD plugin --profile web add "dsh-better-sidebar@${BS_VERSION}"
$DSH_CMD plugin --profile web add "file:$TARBALL"
node "$SCRIPT_DIR/seed-session.mjs" "$DSH_HOME" "$WORKSPACE_DIR" >/dev/null

$DSH_CMD web --port "$PORT" > "$SCRATCH/web.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$SCRATCH"' EXIT

URL=""
for _ in $(seq 1 120); do
  if URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$SCRATCH/web.log" | head -1)" && [ -n "$URL" ]; then break; fi
  sleep 1
done
[ -n "$URL" ] || { echo "dsh web 未就绪" >&2; tail -30 "$SCRATCH/web.log" >&2; exit 1; }

curl -s "$URL/api/workspace.create" -X POST -H 'content-type: application/json' \
  -d "{\"type\":\"client-request\",\"rpcId\":\"capture\",\"method\":\"workspace.create\",\"payload\":{\"path\":\"$WORKSPACE_DIR\"}}" >/dev/null || true

echo "READY $URL"
# 常驻：等到被 kill
wait "$SERVER_PID"
