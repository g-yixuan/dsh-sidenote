# Delivery_01-P1跟修

## 上位约束

本 Delivery 遵循 [PR3-Native侧栏适配加固](../initiative.md)。

## 交付目标

修掉 PR #3 评审发现的全部 P1：聚焦 no-op、reopen 三重死亡、forking 相位草稿丢失、模型面只迁移四分之一、老宿主模型同步无回退链；顺手解决同函数族的 createSideChat 诚实返回与双开竞态。全部带回归测试。

## 交付边界

### 包含

- open.ts / SideChatPanel.tsx / native.ts / lifecycle.ts / slash.ts 的 P1 修复；
- `host/probes.ts` 补登 `remote.session.selectModel` 与 `modelSelection` 投影两条探测；
- 对应单元测试（open.ts 编排层、lifecycle 模型同步链）。

### 不包含

- slash 弹层聚焦列表、sideChatTargetTitle、标题编号的数据源改造（Delivery_02）；
- 架构口味项（rootContext 传参化、Context.remote 删除）。

## Workitems

- `Workitem_01-Native编排修复`：`openOrFocusSideChat` 聚焦改走 `sidebarRight.focus` 探测；`reopenSideChat` 用 seed.meta 携带 childId/parentSessionId；关闭记录源改用 panel 卸载钩子（native 限定）；seedDraft 相位门（非 chat 相位落 meta.pendingDraft）；openTab→mount 窗口的双开竞态去重；createSideChat 失败诚实返回。
- `Workitem_02-模型面迁移`：`readModelName`/`listModels`/`switchModel` 迁到投影 + `remote.session`；fork 模型同步按 `chatSourceOf` 先例做新旧双版本链；`projectedModelSelection` 补 null 守卫与 `lastUsed` 回落；probes 补登；沙箱实测裁决 0.1.2 运行时是否提供 remote.session（决定回退链的真实覆盖面）。

## Git 交付

- repository：g-yixuan/dsh-sidenote
- branch：fix/pr3-p1-followups
- MR：（待创建）
- merged commit：（待合入）
