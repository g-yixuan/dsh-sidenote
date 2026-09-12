# CommitWorkspace_01-Native编排P1

## 上位 Workitem

本 Commit Workspace 服务于 [Workitem_01-Native编排修复](../workitem.md)。

## Git 交付

- repository：g-yixuan/dsh-sidenote（本地 `/Users/gaoyixuan3/gyx_personal_files/dsh_project/dsh-sidenote`）
- base：main（含 PR #3 merge commit 9a3a9dc）
- branch：fix/pr3-p1-followups

## 预期提交

一个 commit：`fix: native 宿主编排修复（聚焦/reopen/草稿相位门/双开竞态/诚实返回）`。核心目的：让 open-or-focus / create / reopen 三条编排在 better-sidebar ≥ 0.19 native 右栏上行为为真——聚焦真实发生（sidebarRight.focus 探测）、重开真实恢复（seed.meta 带 childId）、forking 相位草稿不丢（相位门回落 meta.pendingDraft）、失败不谎报成功。

## 允许范围

- `src/client/sidechat/open.ts`、`native.ts`、`SideChatPanel.tsx`、`slash.ts`、`recentClosed.ts`；
- `src/client/host/probes.ts`（登记 sidebarRight.focus）；
- `tests/` 新增/修改对应单测。

## 初步验证方式

- `pnpm typecheck` + `pnpm test`（含新增编排层单测）；
- 0.1.5+0.19 沙箱四场景实测；
- 日常 legacy 环境（0.1.1+0.17.1）build 后冒烟。

## 开始约定

用户已在评审结论后明确授权立即实施（"开始行动吧"），task.md 公示后直接开工。

## 工作区说明

本目录是本次编码、调研和实验的自由工作空间。

## 完成结果

- Git commit：（待填）
- 实际修改：（待填）
- 已执行验证：（待填）
- 结论：（待填）
- 后续事项：（待填）
