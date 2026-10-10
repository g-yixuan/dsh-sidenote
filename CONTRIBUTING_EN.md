# Contributing

English · [中文](CONTRIBUTING.md)

Bug reports, feature ideas, reproductions, documentation, tests, reviews, and code are all welcome. Start with [good first issue](https://github.com/g-yixuan/dsh-sidenote/labels/good%20first%20issue) or [help wanted](https://github.com/g-yixuan/dsh-sidenote/labels/help%20wanted). You can participate in English or Chinese.

## Choose an entry point

- **Bugs:** use the [bug form](https://github.com/g-yixuan/dsh-sidenote/issues/new?template=bug_report.yml). Include versions, reproduction steps, and actual and expected behavior. Screenshots or recordings help with sidebar and editor issues.
- **Features:** use the [feature form](https://github.com/g-yixuan/dsh-sidenote/issues/new?template=feature_request.yml). Explain the use case and problem first. Discuss new features, interaction changes, compatibility changes, and substantial refactors in an issue before implementation.
- **Questions:** use the [question form](https://github.com/g-yixuan/dsh-sidenote/issues/new?template=question.yml). Issues currently provide a single place for community conversations.
- **Small fixes, typos, documentation, and tests:** a PR is enough; a separate issue is optional.
- **Security vulnerabilities:** follow the [private reporting instructions](SECURITY.md).

Search existing issues and linked PRs before starting. Leave a comment if you want to work on an existing issue. If somebody is already working on it, helping reproduce, test, or review is valuable too.

The project focuses on side chats, selection annotations, reflow, and DSH compatibility. Prefer existing host capabilities and simple implementations with few dependencies. Accepting a proposal does not promise a delivery date.

## Development

CI uses Node.js 22. Use the pnpm version in the `packageManager` field of `package.json`. Fork and clone the repository, then create a topic branch from the latest `main`:

```bash
git switch -c fix/your-change
pnpm install --frozen-lockfile
```

External contributors push to their fork; maintainers also use topic branches. **All changes reach `main` through PRs, including documentation, CI, and version changes. Do not push directly to `main`.**

Basic checks for code changes:

```bash
pnpm check:arch
pnpm typecheck
pnpm build
pnpm test
```

Build before testing: bundle integrity tests use the generated `lib/` output. For documentation-only changes, check content, links, and rendering and describe that validation in the PR. GitHub CI still runs.

### Real host validation

Interaction, session orchestration, and host compatibility changes need relevant E2E or manual validation. Example for the direct host path:

```bash
pnpm exec playwright install chromium
BS_VERSION=none DSH_CMD="npx -y --package @deepseek-ai/dsh@0.1.7-rc.2 dsh" pnpm test:mount
```

The script uses a temporary DSH_HOME. The [CI matrix](.github/workflows/ci.yml) defines tested combinations. CI covers legacy and direct hosts; locally, start with the combinations affected by your change.

Keyless E2E verifies interactions and mounting, not model answers. Changes to opening a side chat while the main session is running, cancellation, queues, or progress snapshots also need a real running-session scenario and explicit validation results. State any limits of your validation.

## Code and tests

- Follow neighboring code style. Keep unrelated formatting, refactors, and dependency upgrades out of a PR.
- `src/index.ts` is the host entry point. `src/client/host/` handles host differences. `sidechat/` and `annotate/` do not depend directly on each other; shared logic belongs in a shared layer.
- Use the existing toolchain. Explain why any new dependency, option, or compatibility branch is needed.
- Bug fixes should add a regression test that reproduces the original problem where applicable. Behavior changes need related tests and documentation. Text-only edits do not require new tests.
- Do not commit `lib/`, test artifacts, personal paths, or local agent records. Remove credentials and private content from screenshots, session logs, and URLs.

## Pull requests

Target `main` and focus on one problem. Use a title prefix such as `fix:`, `feat:`, `docs:`, `test:`, `refactor:`, `ci:`, `chore:`, or `release:`. Titles and descriptions may be in English or Chinese.

Use the PR template to explain the problem, resulting behavior, related issue if any, and validation commands and results. Include screenshots or recordings for interaction changes, and DSH/better-sidebar versions for compatibility changes. Explain when tests do not apply.

Draft PRs are welcome for early discussion. Mark them ready when complete, and address CI failures and review comments. A first-time fork workflow may need a maintainer's approval to run; this does not mean your contribution was rejected.

Do not bump the package version in ordinary feature or fix PRs. Maintainers handle version changes in a separate release PR. Multiple working commits are fine; do not rewrite another contributor's commits just to tidy history.

AI assistance is allowed. You are responsible for understanding and explaining the change and for the reported reproduction and validation. Briefly describe the scope of AI assistance in the PR. Do not submit unchecked generated output or duplicate PRs.

## Collaboration and attribution

Follow the [community standards](CODE_OF_CONDUCT.md). Discuss evidence and respect contributors' and maintainers' time. Maintainers work as time allows; there is no guaranteed response or release schedule.

Preserve contributor authorship when merging and retain co-author information for joint work. GitHub tracks contributors automatically. People who consistently help with reproductions, questions, reviews, and delivery can also participate in [repository maintenance](docs/maintaining_EN.md).

## Documentation languages

The README, contributing, maintenance, and release guides have linked Chinese and English versions. Issue/PR templates, community standards, and security guidance include both languages in one file.

When changing facts about features, procedures, permissions, commands, or compatibility, update both versions in the same PR. Wording or formatting improvements only need to change the relevant version. You do not need to know both languages: point out what needs translating, and maintainers can help complete it.

Issues, PRs, comments, and commit descriptions may use either language without translating every message. Keep label names, commands, and configuration identifiers unchanged.
