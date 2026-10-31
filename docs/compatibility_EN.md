# Host compatibility and maintenance scope

[中文](compatibility.md) · English

The development branch maintains **the current base-version series only**, sharing native Conversation. A series is the complete version without its prerelease suffix, such as `0.2.1`, not all of `0.2.x`. Starting at the current series' minimum compatible RC, later RCs and the unsuffixed release may be installed. Advancing an RC number does not retire supported hosts. Alpha, beta, and outside-window series are not admitted automatically.

Installation eligibility and evidence are separate: **an installable version is not necessarily verified**, and compatibility of unpublished RCs is not guaranteed. In `package.json`, `dshSupport` records the current series' `minimum` and a sorted `verified` list. Ordinary PRs test the current series' minimum and latest verified version, deduplicated; periodic canaries cover intermediate versions and new RCs. Historical npm packages serve retired series; the main branch keeps neither a transition series nor long-lived maintenance branches.

| Series | Minimum compatible host | Verified exact versions | Required hosts on ordinary PRs |
|---|---|---|---|
| Current: 0.2.1 | 0.2.1-rc.2 | rc.2, rc.3, rc.4, rc.5 | 0.2.1-rc.2, 0.2.1-rc.5 |

This table describes the main branch's support range starting with dsh-sidenote 0.8.0; it does not retroactively change published 0.7.6 or other historical packages. Public installation follows each Release and package declaration. Future RCs in the same series are allowed by default but enter `verified` only after validation.

| Retired host | Installation to retain |
|---|---|
| DSH 0.2.0-rc.2 | Pin dsh-sidenote 0.7.6 |
| DSH 0.1.7-rc.2 / 0.1.5-rc.2, no BS | Pin dsh-sidenote 0.6.5 |
| DSH 0.1.1-rc.2 + BS 0.12.3 / 0.18.0 | Pin dsh-sidenote 0.6.5 and the original BS version |
| DSH 0.1.2-rc.1 + BS 0.18.0 | Pin dsh-sidenote 0.6.5 and the original BS version |

0.6.5 includes @lilongsky's V4 reflow fix and subsequent failure acknowledgements, retaining the old interface and validated rc.3 compatibility. Native rc.3 support starts at 0.7.1; historical 0.7.0 does not support it. BS means dsh-better-sidebar; the current branch does not depend on it, and coexistence combinations are unverified.

Outside the window, the current branch carries no separate chat interface or per-PR historical-host matrix and does not backport features or routine fixes. Historical npm packages and Releases remain available. Critical patches are scoped separately; no long-lived branch per host is needed.

## Keeping an older host compatible

On DSH 0.2.0-rc.2, pin its last compatible plugin:

```bash
dsh plugin --profile web add --save-exact dsh-sidenote@0.7.6
```

Earlier 0.1 hosts pin 0.6.5 as listed above. This writes an exact profile dependency so broad dependency updates cannot cross the compatibility boundary. After upgrading into the window, install a compatible newer plugin.

Three layers enforce this policy:

- **Repository:** `dshSupport` records series floors and verified versions. `node scripts/host-window.mjs` checks both DSH engines and the UI primitives peer against the series ranges and generates an exact CI matrix; `--all` emits all verified versions. The current range is `>=0.2.1-rc.2 <0.2.2-0`; each upper bound excludes every prerelease of the next series. DSH 0.2.0 checks DSH peers, so root engines alone is insufficient.
- **npm:** retain historical packages and point `latest` at the current plugin release. Dist-tags are aliases, not host-aware selection; old packages need neither removal nor a new name.
- **DSH installer/market:** enforce the declared range. The 0.2.1 market can select compatible releases from a complete index. Direct CLI installation rejects incompatible targets or restores the prior installation, without promising to search all historical npm versions. Automatic fallback on earlier installers is unverified.

Before rolling the window, validate the new series with full functional, relevant real-model, and visible-browser journeys. Update the inventory, all three ranges, and bilingual guides through a PR, effective with the plugin release. The former series retires; record its last compatible plugin and exact installation command. A new alpha or npm tag change never retires a series. Feature PRs keep the plugin version unchanged; releases use a separate PR.

## Native conversation reuse

Main and side share the host's Conversation, SessionProvider, composer, message flow, queue, commands, file references, attachments, model and reasoning controls, approvals and questions. The plugin adds forks, inherited-history folding, annotations, reflow, saving and recovery. Controlled annotation/reflow sends still use native arbitration and authoritative acceptance.

Side chats currently embed the native chat view. The main session page's Trajectory tab is not embedded in the sidebar, so sharing the chat interface does not imply parity with every main-page view entry.

Integration seams live in `src/client/host/`. Decorating the shared chat View and keyed message registry entries preserves the native renderer. History filtering, quote anchors, progress snapshots and workspace-list hiding rely on runtime slot seams covered by the fixed matrix, rather than a promised permanent hiding API. Unknown shapes retain the native interface without guessing message sources or recipients.

Side chats stay hidden. Their browser/address-local identity outlives tabs and the five-entry recently closed menu; active native sessions are not archived. Saving produces a visible copy of completed history and is blocked while running, submitting, queued, or holding unsent text, attachments or annotations. Send or clear unsent content first so saving cannot close the source while leaving that content out of the copy. General settings offer no visibility toggle, and the former show preference is ignored. Deleted sessions are not restored and historical archives are not undone.

## Diagnostics

General settings offer no diagnostic toggle, and the former user preference is ignored. Developers can enable the header entry with a [temporary flag in the current tab](../CONTRIBUTING_EN.md#developer-diagnostics) to inspect or recheck available, waiting, unknown and unavailable capabilities. The flag survives reloads and expires when the tab closes. Diagnostic presentation does not control capability observation, failure retention or recovery, or change host developer settings.

Acceptance requires durable user/steering or authoritative Queue/Inbox data for the target session, never draft clearing or an optimistic bubble. Recheck is read-only and calls no model. Failed sends retain body, attachments and quotes for retry. Missing precise source messages hide badges without deleting quotes.

Reports download only on request and are never uploaded automatically. They contain software versions, capabilities, reasons and seams, excluding session IDs, prompts, authenticated URLs, cookies, keys and local paths. Inventories read running components; missing versions are not inferred from the CLI or devDependencies. Content search retains the host result limit without fetching extra results after filtering.

## Validation and rolling admission

Relevant PRs run `ci`, every `plugin-mount` for the minimum and latest verified hosts of the current series, and the fixed `host-compatibility` summary. Failed, cancelled, or skipped dependencies cannot pass. Required checks remain ci + host-compatibility. Window changes keep these names; gate-structure changes require updating and reading back the actual ruleset.

Daily canary reads npm's versions and latest / next tags once. Using the same series ranges, it deduplicates and runs full journeys for every published RC/release not yet in `verified`, the current series' newest published version, and in-window channel targets. This also catches RCs whose tags advanced between probes. Every Monday, and when host-canary is enabled manually, it tests every published in-window RC/release, including intermediate versions. Outside-window latest / next targets are recorded and explicitly fail with an admission notice while in-window hosts still run; a missing next may be skipped.

Each host uses official installation, isolated DSH_HOME, actual component versions, and the current bundle digest. Controlled models cover queue, stop, rejection, recovery, and main/side isolation; the separate official Flash lane validates external responses and real tools. Reports distinguish message acceptance from successful model replies. After full functional, relevant real-model, and visible-browser validation, record a new version in `verified` through a PR. Canary does not write verification records, publish plugins, or upgrade user environments, and is outside the required per-PR gate.

Future RCs within a series may be installed before validation completes. If an interface actually breaks, adapt it or narrow the declared range through a PR identifying the affected versions. Evidence covers only versions actually exercised; minimum/latest checks do not replace intermediate-version admission and periodic regression. `pnpm test:compat` verifies that an incompatible update restores the current compatible build. At series retirement, separately verify that the old host rejects the new build and restores the exact historical dependency, package manifest, and client/server bytes; do not retain the old host in ordinary functional matrices. After `pnpm build && pnpm pack`, run this retirement check:

```bash
DSH_CMD="npx -y --package @deepseek-ai/dsh@0.2.0-rc.2 dsh" \
DSH_COMPAT_BASELINE=dsh-sidenote@0.7.6 \
DSH_COMPAT_REJECTED="file:$PWD/dsh-sidenote-$(node -p 'require("./package.json").version').tgz" \
pnpm test:compat
```
