#!/usr/bin/env bash
# Official installer regression: an incompatible update must retain the exact
# last compatible npm release. Everything lives in an isolated DSH_HOME.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_CMD="${DSH_CMD:-dsh}"
SCRATCH="$(mktemp -d /tmp/dsh-sidenote-upgrade.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT
export DSH_HOME="$SCRATCH/home"
PROFILE="$DSH_HOME/profiles/web"
mkdir -p "$PROFILE" "$SCRATCH/incompatible"
cat > "$PROFILE/package.json" <<'EOF'
{"name":"sidenote-upgrade-test","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"],"patchReload":"startup"}}}
EOF
printf '[]\n' > "$PROFILE/cordis.patch.yml"
cat > "$PROFILE/pnpm-workspace.yaml" <<'EOF'
packages: [ . ]
nodeLinker: hoisted
autoInstallPeers: false
allowBuilds:
  node-pty: true
  protobufjs: true
  koffi: true
EOF
$DSH_CMD plugin --profile web add --save-exact dsh-sidenote@0.6.5 > "$SCRATCH/install.log" 2>&1 || { cat "$SCRATCH/install.log"; exit 1; }
cp "$PROFILE/package.json" "$SCRATCH/before.json"
cat > "$SCRATCH/incompatible/package.json" <<'EOF'
{"name":"dsh-sidenote","version":"99.0.0","type":"module","main":"index.js","engines":{"dsh":">=99.0.0"},"dsh":{"bundle":{"patch":"cordis.patch.yml"},"engines":{"dsh":">=99.0.0"}},"peerDependencies":{"@deepseek-ai/dsh-client-ui-primitives":">=99.0.0"}}
EOF
printf '[]\n' > "$SCRATCH/incompatible/cordis.patch.yml"
printf 'export const name = "incompatible-fixture"\n' > "$SCRATCH/incompatible/index.js"
(cd "$SCRATCH/incompatible" && pnpm pack > /dev/null)
set +e
$DSH_CMD plugin --profile web add "file:$SCRATCH/incompatible/dsh-sidenote-99.0.0.tgz" > "$SCRATCH/rejected.log" 2>&1
REJECTED=$?
set -e
[ "$REJECTED" -ne 0 ] || { echo 'Incompatible installation unexpectedly succeeded'; exit 1; }
HOST_VERSION="$($DSH_CMD --version)"
REPORT_DIR="${DSH_E2E_EVIDENCE_DIR:-$ROOT/test-results}"
mkdir -p "$REPORT_DIR"
node - "$PROFILE" "$SCRATCH/before.json" "$SCRATCH/rejected.log" "$HOST_VERSION" "$REJECTED" "$REPORT_DIR" <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const [profile, before, rejected, host, code, output] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
const original = JSON.parse(fs.readFileSync(before, 'utf8'))
const version = JSON.parse(fs.readFileSync(path.join(profile, 'node_modules/dsh-sidenote/package.json'), 'utf8')).version
if (original.dependencies['dsh-sidenote'] !== '0.6.5') throw new Error('Initial dependency was not pinned exactly')
if (JSON.stringify(manifest) !== JSON.stringify(original) || version !== '0.6.5') throw new Error('Failed update did not restore the last compatible release')
if (!/compatib|兼容/i.test(fs.readFileSync(rejected, 'utf8'))) throw new Error('Failure did not identify incompatibility')
fs.writeFileSync(path.join(output, `compatibility-rollback-${host}.json`), JSON.stringify({ host, pinnedPlugin: '0.6.5', rejectedPlugin: '99.0.0 (local fixture)', rejectedExit: Number(code), restoredPlugin: version, exactDependencyRetained: true }, null, 2) + '\n')
console.log(`DSH ${host}: rejected incompatible update; exact plugin 0.6.5 retained`)
JS
