# 发布指南

本指南适用于 `g-yixuan/dsh-sidenote` 仓库及 npm 包 `dsh-sidenote` 的维护者。

## 前提

- 具有向本仓库推送版本提交、tag 和发布 GitHub Release 的权限。
- npm 包已配置 [Trusted Publisher](https://docs.npmjs.com/trusted-publishers)：GitHub 用户 `g-yixuan`、仓库 `dsh-sidenote`、workflow `release.yml`。

发布由 GitHub Actions 通过 OIDC 授权执行，无需在本机登录 npm。fork 仓库需要为自己的 npm 包另行配置发布授权。

## 发布步骤

1. 更新 `package.json` 的版本，提交并推送到 `main`，准备发布说明。
2. 确认待发布提交的 CI 通过，包括 `ci` 检查和全部 `plugin-mount` 宿主兼容矩阵。
3. 在该提交上创建与版本对应的 `vX.Y.Z` tag，并推送到仓库：

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. 在 GitHub Releases 中选择该 tag、填写发布说明并发布 Release。单独推送 tag 不会触发发布 workflow。
5. 检查 Release workflow 成功，并确认 npm 上的版本：

   ```bash
   npm view dsh-sidenote@X.Y.Z version
   ```

## 自动化

[`release.yml`](../.github/workflows/release.yml) 校验 Release tag 与 `package.json` 版本一致，随后构建、检查类型、运行单测并发布带 provenance 的 npm 包。该版本已在 npm 上存在时，跳过发布。

workflow 也支持手动运行：`dry_run=true` 只做验证，`dry_run=false` 会发布所选 ref 对应的版本。
