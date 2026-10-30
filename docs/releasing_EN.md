# Release guide

English · [中文](releasing.md)

This guide applies to maintainers of `g-yixuan/dsh-sidenote` and the npm package `dsh-sidenote`.

## Prerequisites

- Permission to push version commits and tags to this repository and publish GitHub Releases.
- The npm package has a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers) configured for the GitHub user `g-yixuan`, repository `dsh-sidenote`, and workflow `release.yml`.

GitHub Actions publishes through OIDC authorization without requiring a local npm login. Forks need their own npm package and publishing authorization.

## Release steps

1. Create a release branch from `main`, update the version in `package.json`, prepare release notes, and open a `release:` PR. Do not push version changes directly to `main`.
2. Wait for the release PR's `ci` and all `plugin-mount` host matrix checks to pass, then merge into `main`. Confirm CI also passes for that merged commit.
3. Create the matching `vX.Y.Z` tag at that version commit on `main` and push it:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. Select the tag in GitHub Releases, enter release notes, and publish the release. Briefly describe changes, compatibility, and known limits in Chinese and English. Generate release notes can list PRs and contributors. Pushing a tag alone does not trigger publishing.
5. Check that the Release workflow succeeds and confirm the npm version:

   ```bash
   npm view dsh-sidenote@X.Y.Z version
   ```

## Automation

[`release.yml`](../.github/workflows/release.yml) verifies the Release tag matches `package.json` and the version commit has been merged into `main`, then builds, typechecks, runs unit tests, and publishes the npm package with provenance. Publishing is skipped if the version already exists on npm.

A manual workflow run only builds, validates, and performs a dry-run. Publishing is triggered by a GitHub Release.

## Compatibility-window changes

Before release, run `node scripts/host-window.mjs` to align the current series' minimum and verified inventory, and three install ranges. Every boundary-host job and the fixed ci + host-compatibility checks must pass, and the actual ruleset must require both. New verified records need full functional, relevant real-model, and visible-browser evidence; ranges covering future RCs do not imply verification. Series rollover takes effect through a PR and plugin release; newer RCs do not retire earlier RCs in the same series. Record each retired series' last compatible plugin and exact installation command; 0.2.0-rc.2 pins 0.7.6 and historical 0.1 hosts still pin 0.6.5. New rules do not change historical packages, and npm tags do not select by host. See the [compatibility policy](compatibility_EN.md).