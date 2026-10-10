# Repository maintenance

English · [中文](maintaining.md)

These rules apply to maintainers with write, merge, or release access and the agents they use. See [CONTRIBUTING](../CONTRIBUTING_EN.md) for contributor guidance. The current lead maintainer is [@g-yixuan](https://github.com/g-yixuan).

## Development and merging

- `main` is the single development branch. Features, fixes, documentation, CI, dependencies, and versions all use topic branches and PRs. Maintainers and agents follow the same rules.
- Before merging, `ci` and all five pinned `plugin-mount` host checks must pass, review threads must be addressed, and the branch must be compatible with current `main`. The weekly `host-canary` tracks host drift separately and is not a required check on every PR.
- Do not push directly to, force-push, or delete `main`. Manual publishing cannot replace merge checks. Urgent fixes still use small PRs. Fix CI failures or publicly explain a targeted rule adjustment; do not routinely ignore failed checks.
- Maintainers review the problem, scope, regression risks, and validation evidence. External PRs need maintainer review. While there is one maintainer, their own PRs may merge after self-review and all required checks; a mandatory second-person approval would block development.
- GitHub currently requires zero independent approvals while still enforcing PRs, CI, and resolved review threads. Once there are at least two active, reliable maintainers, require one approval and have another maintainer review an author's own PR.
- Normally use Squash and merge for one clear change per PR. A merge commit may preserve separate commits or joint work. Check author and co-author attribution before merging; do not replace external authorship with your own.
- PR titles describe resulting user behavior. GitHub cleans up merged branches according to repository settings. Do not rewrite merged history.

A GitHub ruleset enforces the `main` requirements: PRs, basic CI and the pinned host matrix, resolved review threads, and no force-pushes or deletion. Maintainers have no routine bypass. PRs changing the CI matrix must also update the ruleset's check names to avoid obsolete requirements. Configure it under Settings → Rules → Rulesets.

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
