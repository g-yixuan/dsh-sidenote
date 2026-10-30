#!/usr/bin/env bash
# Official installer regression: an incompatible update must retain the exact
# compatible package. DSH_COMPAT_BASELINE can pin a legacy npm release on an
# older host; new hosts use the current tarball, whose series range admits them.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_CMD="${DSH_CMD:-dsh}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
BASELINE="${DSH_COMPAT_BASELINE:-file:${TARBALL:-$ROOT/dsh-sidenote-$VERSION.tgz}}"
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
$DSH_CMD plugin --profile web add --save-exact "$BASELINE" > "$SCRATCH/install.log" 2>&1 || { cat "$SCRATCH/install.log"; exit 1; }
cp "$PROFILE/package.json" "$SCRATCH/before.json"
cp "$PROFILE/node_modules/dsh-sidenote/package.json" "$SCRATCH/before-package.json"
cp "$PROFILE/node_modules/dsh-sidenote/lib/index.js" "$SCRATCH/before-index.js"
cp "$PROFILE/node_modules/dsh-sidenote/lib/client.js" "$SCRATCH/before-client.js"
cat > "$SCRATCH/incompatible/package.json" <<'EOF'
{"name":"dsh-sidenote","version":"99.0.0","type":"module","main":"index.js","engines":{"dsh":">=99.0.0"},"dsh":{"bundle":{"patch":"cordis.patch.yml"},"engines":{"dsh":">=99.0.0"}},"peerDependencies":{"@deepseek-ai/dsh-client-ui-primitives":">=99.0.0"}}
EOF
printf '[]\n' > "$SCRATCH/incompatible/cordis.patch.yml"
printf 'export const name = "incompatible-fixture"\n' > "$SCRATCH/incompatible/index.js"
(cd "$SCRATCH/incompatible" && pnpm pack > /dev/null)
# At a series retirement, use the real new tarball as the rejected target and
# the last compatible npm package as DSH_COMPAT_BASELINE on the retired CLI.
TARGET="${DSH_COMPAT_REJECTED:-file:$SCRATCH/incompatible/dsh-sidenote-99.0.0.tgz}"
set +e
$DSH_CMD plugin --profile web add "$TARGET" > "$SCRATCH/rejected.log" 2>&1
REJECTED=$?
set -e
[ "$REJECTED" -ne 0 ] || { echo 'Incompatible installation unexpectedly succeeded'; exit 1; }
HOST_VERSION="$($DSH_CMD --version)"
REPORT_DIR="${DSH_E2E_EVIDENCE_DIR:-$ROOT/test-results}"
mkdir -p "$REPORT_DIR"
node - "$PROFILE" "$SCRATCH/before.json" "$SCRATCH/rejected.log" "$HOST_VERSION" "$REJECTED" "$REPORT_DIR" "$SCRATCH/before-package.json" <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const [profile, before, rejected, host, code, output, beforePackage] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
const original = JSON.parse(fs.readFileSync(before, 'utf8'))
const installed = JSON.parse(fs.readFileSync(path.join(profile, 'node_modules/dsh-sidenote/package.json'), 'utf8'))
const pinnedPackage = JSON.parse(fs.readFileSync(beforePackage, 'utf8'))
const version = installed.version, pinned = pinnedPackage.version
const dependency = original.dependencies['dsh-sidenote']
if (dependency !== pinned && !dependency.startsWith('file:')) throw new Error('Initial dependency was not pinned exactly')
if (JSON.stringify(manifest) !== JSON.stringify(original) || JSON.stringify(installed) !== JSON.stringify(pinnedPackage)) throw new Error('Failed update did not restore the compatible package')
for (const entry of ['index', 'client']) {
  const expected = fs.readFileSync(path.join(path.dirname(beforePackage), `before-${entry}.js`))
  if (!expected.equals(fs.readFileSync(path.join(profile, 'node_modules/dsh-sidenote/lib', `${entry}.js`)))) throw new Error('Failed update left different bundle bytes: ' + entry)
}
if (!/compatib|兼容/i.test(fs.readFileSync(rejected, 'utf8'))) throw new Error('Failure did not identify incompatibility')
fs.writeFileSync(path.join(output, `compatibility-rollback-${host}-${pinned}.json`), JSON.stringify({ host, pinnedPlugin: pinned, rejectedPlugin: process.env.DSH_COMPAT_REJECTED ? 'explicit incompatible target' : '99.0.0 (local fixture)', rejectedExit: Number(code), restoredPlugin: version, exactDependencyRetained: true, bundleBytesRetained: true }, null, 2) + '\n')
console.log(`DSH ${host}: rejected incompatible update; exact plugin ${pinned} retained`)
JS
