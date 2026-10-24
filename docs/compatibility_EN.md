# Host compatibility and maintenance scope

[中文](compatibility.md) · English

The development branch maintains the latest **two admitted exact DSH releases that share the native Conversation implementation**. This does not mean two major versions or automatic admission of npm latest. Published installations follow their Release declarations; the already-published 0.6.5 package keeps its original compatibility range.

| Exact host | Current branch | Outside-window installation |
|---|---|---|
| DSH 0.2.1-rc.2, no BS | Full maintenance; required CI | — |
| DSH 0.2.0-rc.2, no BS | Full maintenance; required CI | — |
| DSH 0.2.1-rc.3, no BS | Native Conversation admission pending | Pin dsh-sidenote 0.6.5 |
| DSH 0.1.7-rc.2 / 0.1.5-rc.2, no BS | Retired | Pin dsh-sidenote 0.6.5 |
| DSH 0.1.1-rc.2 + BS 0.12.3 / 0.18.0 | Retired | Pin 0.6.5 and the original BS version |
| DSH 0.1.2-rc.1 + BS 0.18.0 | Retired | Pin 0.6.5 and the original BS version |

0.6.5 includes @lilongsky’s V4 reflow fix and the follow-up failure acknowledgements, retaining the previous UI and validated rc.3 compatibility. The old-UI result does not admit rc.3 for this native implementation; its separate admission will roll the two-version window.

BS means dsh-better-sidebar. The current branch does not depend on it. Unlisted hosts, alpha releases and BS coexistence combinations are unverified.

Outside the window, the current branch carries no separate chat UI or per-PR host matrix and does not backport features or routine fixes. Historical npm packages and Releases remain available. No long-lived branch per host is needed. A critical problem may warrant a separately scoped patch decision; this does not imply indefinite maintenance.

## Keeping an older host compatible

Pin its last compatible plugin:

```bash
dsh plugin --profile web add --save-exact dsh-sidenote@0.6.5
```

This writes an exact profile dependency so ordinary range updates cannot cross the compatibility boundary. Explicitly choosing another version is a separate operation. After upgrading to an admitted host, install a compatible newer plugin.

Three layers enforce this policy:

- **Repository:** maintain declarations, implementation and validation. The current range `=0.2.0-rc.2 || =0.2.1-rc.2` appears in `engines.dsh`, `dsh.engines.dsh` and the UI primitives peer. DSH 0.2.0 checks DSH peers, so root engines alone is insufficient.
- **npm:** retain historical packages and point `latest` at the current release. Dist-tags are aliases, not host-aware selection. Older packages need neither removal nor a new package name.
- **DSH installer/market:** enforce compatibility. The 0.2.1 market can filter compatible releases if its index contains their metadata. Direct CLI installation rejects an incompatible target or restores the prior installation; it does not promise to search every historical npm version. Automatic fallback on earlier installers is unverified, hence the exact-version command above.

Before raising the host requirement, identify retired hosts and their last compatible plugin. Update all three ranges, bilingual guides, CI and the actual GitHub ruleset in the same PR. Retain the old npm package after publishing. Feature PRs do not bump the package version; releases use a separate PR.

## Native conversation reuse

Main and side share the host's Conversation, SessionProvider, composer, message flow, queue, commands, file references, attachments, model and reasoning controls, approvals and questions. The plugin adds forks, inherited-history folding, annotations, reflow, saving and recovery. Controlled annotation/reflow sends still use native arbitration and authoritative acceptance.

Side chats currently embed the native chat view. The main session page's Trajectory tab is not embedded in the sidebar, so sharing the chat interface does not imply parity with every main-page view entry.

Integration seams live in `src/client/host/`. Decorating the shared chat View and keyed message registry entries preserves the native renderer. History filtering, quote anchors, progress snapshots and workspace-list hiding rely on runtime slot seams covered by the fixed matrix, rather than a promised permanent hiding API. Unknown shapes retain the native interface without guessing message sources or recipients.

Side chats stay hidden by default. Their browser/address-local identity outlives tabs and the five-entry recently closed menu; active native sessions are not archived. Saving produces a visible copy of completed history and is blocked while running, submitting, queued, or holding unsent text, attachments or annotations. Send or clear unsent content first so saving cannot close the source while leaving that content out of the copy. “Show side chats in the session list” reveals registered children without restoring deleted sessions or unarchiving historical ones.

## Diagnostics

Diagnostics are off by default. Enable **Settings → General → dsh-sidenote diagnostic mode**, then inspect or recheck available, waiting, unknown and unavailable capabilities in the header. The preference belongs to this browser and DSH address; failed persistence is labeled page-only. Disabling diagnostics preserves capability observation, failure retention and recovery and does not change host developer settings.

Acceptance requires durable user/steering or authoritative Queue/Inbox data for the target session, never draft clearing or an optimistic bubble. Recheck is read-only and calls no model. Failed sends retain body, attachments and quotes for retry. Missing precise source messages hide badges without deleting quotes.

Reports download only on request and are never uploaded automatically. They contain software versions, capabilities, reasons and seams, excluding session IDs, prompts, authenticated URLs, cookies, keys and local paths. Inventories read running components; missing versions are not inferred from the CLI or devDependencies. Content search retains the host result limit without fetching extra results after filtering.

## Validation and rolling admission

Relevant PRs require `ci`, `plugin-mount (0.2.0-rc.2, none)` and `plugin-mount (0.2.1-rc.2, none)`. Both hosts use official installation, isolated DSH_HOME, runtime component versions and the current bundle digest for the same full user journeys. A controlled model makes queue, stop, rejection and recovery repeatable; the separate official Flash lane validates external responses and real tools. Reports distinguish message acceptance from successful model replies.

Pin each candidate exactly, complete functional, real-runtime and UI validation, then admit it through a PR that removes the oldest window member, records its last compatible plugin and synchronizes required-check names. The window never grows indefinitely or justifies rebuilding chat to keep two members. Narrow support explicitly if native interfaces cannot be shared.

Weekly canary resolves latest once and validates that exact release. Failures retain evidence and may indicate a need for admission; they never change compatibility declarations or user environments automatically.
