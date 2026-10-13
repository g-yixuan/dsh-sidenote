# Host compatibility and maintenance scope

[中文](compatibility.md) · English

This table describes validation and maintenance for the development branch. A merge is not an npm release; also read the Release corresponding to an installed package. Engine ranges are installation boundaries, not proof that every rc or plugin combination has passed.

| Exact combination | Category | Validation gate |
|---|---|---|
| DSH 0.1.7-rc.2, no BS | Maintained | Full fixed journeys for every relevant PR |
| DSH 0.1.5-rc.2, no BS | Extended maintenance for the current user environment | The same full fixed journeys |
| DSH 0.1.1-rc.2 + BS 0.12.3 | Frozen legacy, lower-bound representative | Full fixed journeys and existing commitments |
| DSH 0.1.1-rc.2 + BS 0.18.0 | Frozen legacy, separate combination | Full fixed journeys; removal requires a retirement PR |
| DSH 0.1.2-rc.1 + BS 0.18.0 | Frozen legacy, API-generation representative | Full fixed journeys |
| DSH 0.2.0-rc.2, no BS | Maintained; exact release admitted | Full fixed journeys and a required host check |

BS means dsh-better-sidebar. Unlisted combinations are unverified. Independence from BS does not prove every native-host + BS 0.19+ coexistence combination. Alpha hosts have no release compatibility commitment.

Admission record for development main, 2026-10-13: test package 0.4.6, build digest `9a111c6d36221c44cea7a5024aecdeccdb89856e37c848d93adb9613c9629047`, six combinations / 141 real E2E tests, 310 tests, and complete visible-browser workflows on 0.1.5/0.1.7/0.2 passed. [Validation CI](https://github.com/g-yixuan/dsh-sidenote/actions/runs/38281154300). Runtime cases use a controlled model; external model answers are outside this validation. The already published old 0.4.6 package does not contain these fixes.

The added installation declaration admits only exact `0.2.0-rc.2`: `>=0.1.1-rc.1 <0.2.0 || =0.2.0-rc.2`; UI primitives adds the same exact release. Other 0.2 rc, stable and alpha releases still need admission.

Frozen support retains its integration and declared workflows without backporting every new host feature. Data loss, delivery to the wrong session and installation regressions still need attention. The default window is two fully validated host lines plus one explicit extended environment; it never removes old checks automatically. Retirement requires a separate PR recording the last validated plugin/host versions, impact, alternatives and bilingual notice. Without reliable data, do not infer host-version shares from npm downloads or add telemetry.

## Integration and diagnosis

The main message/composer DOM, session input, durable content, acceptance, model and sidebar differences touched here live in `src/client/host/`. Features retain source/target semantics, fork lifecycle and saving rules. Keep evidenced generation boundaries; do not introduce an adapter-class registry by version.

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

The five required combinations remain, with `plugin-mount (0.2.0-rc.2, none)` added as the sixth host check. Weekly canary resolves latest once, then runs that exact version with the same journeys and inventory. Failures retain evidence and remain visible in their job; they never automatically expand support or change the user's environment. Use existing GitHub Actions status rather than a new notification bot.

Ctrl/Cmd+Enter Steer follows the host's step boundaries. A subsequent send wakes the queue preserved by Stop. Record message acceptance and successful model answers separately.
