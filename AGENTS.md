# Repository instructions

- Read `CONTRIBUTING.md` and `docs/maintaining.md` before making changes. They apply to maintainers and agents alike.
- Work on a topic branch and open a PR against `main` for every change, including documentation, CI, and release versions. Never push directly to or force-push `main`.
- Keep changes focused. Do not add dependencies, configuration, formatting churn, or abstractions without a concrete need. Small fixes do not require a separate issue; discuss substantial feature or compatibility changes first.
- For code changes, run the relevant checks: architecture gates, typecheck, build, then tests. Bundle integrity tests require current build output. UI/session/host changes also need relevant host validation; document gaps honestly.
- Keep `sidechat/` and `annotate/` independent; shared code belongs in a shared layer. Preserve host compatibility through `src/client/host/`.
- Preserve external contributors' authorship and co-author information. Do not rewrite merged history or bump package versions outside a release PR.
- Update both Chinese and English public guides in the same PR when changing features, rules, commands, or compatibility facts. Wording-only edits and everyday issue/PR discussions do not require translations.
- Do not commit generated `lib/`, test output, local agent records, credentials, or personal environment details. `.vibe/` is optional local bookkeeping and is not part of the public contribution process; when using worktrees, keep it only in the primary checkout.
