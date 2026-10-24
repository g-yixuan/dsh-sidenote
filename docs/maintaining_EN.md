# Repository maintenance

English · [中文](maintaining.md)

These rules apply to maintainers with write, merge, or release access and the agents they use. See [CONTRIBUTING](../CONTRIBUTING_EN.md) for contributor guidance. The current lead maintainer is [@g-yixuan](https://github.com/g-yixuan).

## Development and merging

- `main` is the single development branch. Features, fixes, documentation, CI, dependencies, and versions all use topic branches and PRs. Maintainers and agents follow the same rules.
- Before merging, `ci` and the fixed `host-compatibility` summary must pass. The summary requires every admitted `plugin-mount`, including preview, and rejects failed, cancelled or skipped dependencies. Review threads must be addressed and the branch compatible with main. `host-canary` tracks latest / next drift separately and is not required on every PR.
- Do not push directly to, force-push, or delete `main`. Manual publishing cannot replace merge checks. Urgent fixes still use small PRs. Fix CI failures or publicly explain a targeted rule adjustment; do not routinely ignore failed checks.
- Maintainers review the problem, scope, regression risks, and validation evidence. External PRs need maintainer review. While there is one maintainer, their own PRs may merge after self-review and all required checks; a mandatory second-person approval would block development.
- GitHub currently requires zero independent approvals while still enforcing PRs, CI, and resolved review threads. Once there are at least two active, reliable maintainers, require one approval and have another maintainer review an author's own PR.
- Normally use Squash and merge for one clear change per PR. A merge commit may preserve separate commits or joint work. Check author and co-author attribution before merging; do not replace external authorship with your own.
- PR titles describe resulting user behavior. GitHub cleans up merged branches according to repository settings. Do not rewrite merged history.

A GitHub ruleset enforces the `main` requirements: PRs, ci and the fixed host-compatibility summary, resolved review threads, and no force-pushes or deletion. Maintainers have no routine bypass. Ordinary host-window changes no longer replace version-specific required checks. When gate structure changes, verify the new check passes before updating and reading back the ruleset; never leave an empty gate or ignore failures. Configure it under Settings → Rules → Rulesets.

Host validation uses the same core journey across versions: a real child fork, usable inherited history and input, and an accepted message in the child's durable log but absent from the parent's log. A tab, fork error, or optimistically cleared draft alone cannot pass. Keyless validation proves admission and interaction, not a successful model response.

Each CI combination saves `test-results/host-inventory.json`, screenshots, and failure logs. The inventory checks the exact CLI, active client bundle versions, resolved host dependencies, and this plugin build's digest. Unreadable component versions remain unknown; the CLI and devDependencies are not substitutes. A stale installed build is rejected before browser journeys and checked again afterward. Set `DSH_EXPECTED_VERSION` for a manually pinned run: the script rejects a mismatch or missing command instead of falling back to latest.

Roles currently contain current=0.2.1-rc.2, previous=0.2.0-rc.2 and preview=0.2.1-rc.3, all sharing native Conversation. The five historical combinations retire and pin 0.6.5. Native rc.3 support starts with plugin 0.7.1; historical 0.7.0 is incompatible. Weekly or manual canary resolves latest / next once each, explicitly records and fails unadmitted candidates, and runs full journeys for admitted hosts. New hosts still require functional, relevant real-model and visible-browser admission before a PR updates roles, the three ranges and bilingual support tables. Candidate probes never expand support automatically.

See the [compatibility policy](compatibility_EN.md) for role-based admission. New next replaces only preview. Once regular-host admission ships, current becomes previous, the old previous retires, and an overlapping preview is cleared. Outside-window packages remain available without routine backports or a separate implementation. Each retirement PR records the last compatible plugin and exact installation command.

## Issues and proposals

Check for duplicates, sufficient reproduction, project relevance, and supported host versions. When information is missing, explain what is needed and suggest actionable reproduction steps.

| Label | Purpose |
|---|---|
| `bug` / `enhancement` / `question` / `documentation` | Issue type |
| `needs reproduction` | Versions, steps, or a verifiable reproduction are needed; remove once supplied |
| `accepted` | Scope and direction are accepted; implementation can start, without a promised date |
| `help wanted` | Explain whether reproduction, testing, documentation, or code help is needed |
| `good first issue` | A small, clear task with entry points, completion criteria, and maintainer help |
| `duplicate` / `wontfix` | Link the existing issue or explain the decision when closing |

Prioritize data loss, execution in the wrong session, unusable functionality, and regressions in supported hosts, then ordinary defects and features. Maintainers assess impact rather than asking reporters to assign priority.

Discuss use cases, boundaries, alternatives, and acceptance criteria for substantial proposals. Small fixes do not all need a separate issue. Link implementation PRs to their issue and describe affected versions when completing the work. Merged does not mean released.

Do not automatically close issues or PRs based on inactivity. Maintainers explain why something cannot proceed when closing it, and new evidence can justify reopening. Maintenance happens as time allows without a guaranteed response SLA.

## Growing participation

Turn accepted small tasks into actionable issues: explain the problem, relevant files or entry points, scope, and completion criteria before adding `good first issue` or `help wanted`.

Invite help with reproductions, questions, testing, and review, and acknowledge it in issues, PRs, and releases. Use GitHub's automatic contributor tracking without maintaining an avatar list in the README.

People who contribute reliably and want to maintain the project can discuss responsibilities publicly with existing maintainers. Start with triage and review, grant repository permissions according to responsibilities, and clarify merge and release access separately. There is no fixed contribution count or permanent on-call requirement. Discuss handoff and adjust access when participation ends.

## Releases and rule changes

Version changes also use release PRs. Once checks pass and the PR merges, create a GitHub Release using the [release guide](releasing_EN.md). Briefly describe changes, compatibility, and known limits in Chinese and English; link relevant PRs and retain contributor credit. GitHub's Generate release notes uses the [category configuration](../.github/release.yml).

New rules, approval requirements, compatibility changes, and maintenance responsibilities are discussed publicly through PRs. There is currently no CLA, DCO sign-off, mandatory review bot, or extra contributor account verification.

Update both language versions in the same PR when changing public rules, commands, or procedures. Maintainers can help contributors translate. Single-language wording improvements, everyday issue/PR discussions, and local working notes do not need translations. See [documentation languages](../CONTRIBUTING_EN.md#documentation-languages).
