# Host compatibility and maintenance scope

[中文](compatibility.md) · English

This table lists validated combinations and maintenance promises for the current main branch. For published versions, check the corresponding Release; 0.6.2 and earlier do not declare support for DSH 0.2.1-rc.2. Engine ranges are installation gates, not proof that every rc or plugin combination inside them was validated.

| Exact combination | Category | Validation gate |
|---|---|---|
| DSH 0.1.7-rc.2, no BS | Maintained | Full fixed journeys for every relevant PR |
| DSH 0.1.5-rc.2, no BS | Extended maintenance for the current user environment | The same full fixed journeys |
| DSH 0.1.1-rc.2 + BS 0.12.3 | Frozen legacy, lower-bound representative | Full fixed journeys and existing commitments |
| DSH 0.1.1-rc.2 + BS 0.18.0 | Frozen legacy, separate combination | Full fixed journeys; removal requires a retirement PR |
| DSH 0.1.2-rc.1 + BS 0.18.0 | Frozen legacy, API-generation representative | Full fixed journeys |
| DSH 0.2.0-rc.2, no BS | Maintained; exact release admitted | Full fixed journeys and a required host check |
| DSH 0.2.1-rc.2, no BS | Maintained; exact release admitted | Full fixed journeys and a required host check |

BS means dsh-better-sidebar. Unlisted combinations are unverified. Independence from BS does not prove every native-host + BS 0.19+ coexistence combination. Alpha hosts have no release compatibility commitment.

0.5.0 includes unified main/side annotations, side-reply selection, content retention and recovery on failure, and opt-in compatibility diagnostics. The earlier [host admission CI](https://github.com/g-yixuan/dsh-sidenote/actions/runs/38281154300) and [final feature validation CI](https://github.com/g-yixuan/dsh-sidenote/actions/runs/38344084161) record actual runtime versions, build digests and evidence for each maintained combination; the latter passed six combinations / 153 real E2E tests and 313 unit tests. Runtime cases use a controlled model; external model answers are outside this validation. The old 0.4.6 release does not contain these changes.

For the 0.2 series, installation admits only exact `0.2.0-rc.2` and `0.2.1-rc.2`: `>=0.1.1-rc.1 <0.2.0 || =0.2.0-rc.2 || =0.2.1-rc.2`; UI primitives admits the same two exact releases. DSH 0.2.1 gives `engines.dsh` precedence when checking plugin compatibility, so both DSH engine declarations and the UI primitives peer range stay aligned. Other 0.2 rc, stable and alpha releases still need admission.

[Admission for 0.2.1-rc.2](https://github.com/g-yixuan/dsh-sidenote/pull/32) uses an isolated DSH_HOME, the official plugin installation channel and the current plugin build. Full journeys cover main/side annotations, real forks and durable delivery, images, failure recovery, Queue/Steer/Stop, busy forks, reflow and side-chat hiding. Settings opens from the account menu at the lower left on this host. Runtime cases use a local controlled model; external model services and coexistence with BS on the new host are outside this validation.

Frozen support retains its integration and declared workflows without backporting every new host feature. Data loss, delivery to the wrong session and installation regressions still need attention. The default window is two fully validated host lines plus one explicit extended environment; it never removes old checks automatically. Retirement requires a separate PR recording the last validated plugin/host versions, impact, alternatives and bilingual notice. Without reliable data, do not infer host-version shares from npm downloads or add telemetry.

## Integration and diagnosis

The main message/composer DOM, session input, durable content, acceptance, model and sidebar differences touched here live in `src/client/host/`. Features retain source/target semantics, fork lifecycle and saving rules. Keep evidenced generation boundaries; do not introduce an adapter-class registry by version.

Side-chat hiding is owned entirely by the plugin. Before a creation request, the sidebar temporarily holds new rows until the returned child ID is durably registered; existing rows keep updating, and failures release the hold. Only the workspace list input is filtered; the global catalog, bindings and message delivery are preserved. DSH 0.1.7+ keeps side chats unarchived so its archive gate cannot block model execution. Historical hosts retain archiving. Saving creates a visible regular copy, closes the source tab before navigation, and adapts both `uiWorkspace.openSession` and historical `sessions.open`.

The list seam lives in `host/sessionList.tsx`, detects the native workspace slot, preserves grouping, search, actions, locale and injection, and restores the original component on disposal. It uses mutable runtime slot entries rather than a promised session-hiding API. Unrecognized shapes retain the native list; side chats may remain visible without archiving them into a model-blocked state on newer hosts. The seven fixed combinations continue to guard this seam.

Content search retains the host's result limit; filtering hidden side chats does not fetch additional results beyond that page.

The browser-local visibility index outlives tabs and the five-entry recently closed menu and is scoped to the DSH address. Upgrade migration uses surviving side-chat metadata and recently closed records. Older sessions with no remaining identity record cannot be reliably classified and stay visible. On DSH 0.1.7+, **Settings → General → Show side chats in the session list** reveals registered side chats. A storage warning explains page-only operation when persistence fails. This neither restores deleted sessions nor unarchives chats archived by historical versions.

Diagnostics are off by default, with no diagnostic header button or overall restriction badge during ordinary use. To debug or report a problem, enable **Settings → General → dsh-sidenote diagnostic mode**, then open **Compatibility diagnostics** in the session header to inspect or recheck available, waiting, unknown and unavailable capabilities. The choice is local to this browser and DSH address and survives refresh. If the browser refuses local saving, the settings row explains that it applies only to the current page. Disabling the mode immediately hides the panel and button without changing body, attachments, quotes or side chats, or disabling capability observation and input recovery. It neither reads nor writes the host's global developer setting. All maintained combinations use the same plugin opt-in rather than following newer hosts' enabled-by-default developer mode.

Missing services, sessions or DOM at boot remain waiting; a supplied interface missing a required method is unavailable, while a failed read remains unknown. Empty sessions, absent side chats and unknown versions do not trigger automatic error notifications. Acceptance is confirmed only after observing durable user/steering or authoritative Queue/Inbox data for the current session generation, never from draft clearing or an optimistic bubble. Rechecking only reads state: it does not send test messages, create side chats or call a model.

Restricted operations retain saved quotes, body and attachments, with reasons in the existing editor/chip/composer. Recheck and retry after recovery; if another native draft conflicts, retain local content and review it before sending. A missing precise source hides its badge without deleting the quote or guessing another session.

Reports are downloaded only when **Export report** is clicked and are never uploaded automatically. They contain software versions, capabilities, reasons and integration paths only, excluding session IDs, user text, authenticated URLs, cookies, keys and local filesystem paths. The plugin version comes from the build manifest. Host/components without reliable metadata stay unknown; CI inventories read actual running components rather than inferring them from devDependencies or the CLI.

## Validation and candidate admission

1. Resolve an official dist-tag once, then pin the exact version. Installation failures must fail, never fall back to latest.
2. Isolate DSH_HOME/profile, workspace and port; verify the CLI, runtime components and current bundle digest. Do not upgrade the daily instance.
3. Every fixed combination runs the same main→main, main→side, side→side, editor/chip, full protocol, failure/retry, recovery/isolation and reflow journeys. Related Queue/Steer/Stop, busy fork, model and image cases use real host chains too.
4. Separate install/host failures, plugin API/DOM changes and test locator errors. Preserve failures, make focused fixes and rerun maintained combinations without lowering assertions or skipping features.
5. Complete relevant functionality, real runtime cases and visible-browser validation before promoting a candidate via PR. Update support claims, installation ranges, both guides and required checks together, checking the actual GitHub ruleset context names.

The six required combinations remain, with `plugin-mount (0.2.1-rc.2, none)` added as the seventh host check. Weekly canary resolves latest once, then runs that exact version with the same journeys and inventory. Failures retain evidence and remain visible in their job; they never automatically expand support or change the user's environment. Use existing GitHub Actions status rather than a new notification bot.

Ctrl/Cmd+Enter Steer follows the host's step boundaries. A subsequent send wakes the queue preserved by Stop. Record message acceptance and successful model answers separately.
