# Workitem_02-模型面迁移

## 上位约束

本 Workitem 遵循 [Delivery_01-P1跟修](../delivery.md)。

## 目标

模型功能四件套（fork 同步、标签读取、目录列举、面板切换）在 0.1.5 与 0.1.2 上全部可用或显式降级，不再押在已删除的 `connection.api.sessions.*` 面上；host/probes.ts 补登全部新增 off-face 面。

## 范围与非目标

### 范围

- `readModelName`：改读 `modelSelection` 投影（同步、无 RPC）；
- `listModels` / `switchModel`：迁到 `remote.session.modelCatalog` / `remote.session.selectModel`；
- fork 模型同步：按 `chatSourceOf` 先例做新面优先、旧面（connection.api）回退的双版本链；
- `projectedModelSelection`：补 `next` 的 null 守卫与 `lastUsed` 回落；
- `remoteSessionFace`：候选链修正（`ctx.remote?.session` 在插件根 ctx 恒抛恒吞，降为次级；`ctx.get('remote')` 候选下钻 `.session`）；
- probes.ts：登记 `remote.session.selectModel` / `modelSelection` 投影 / `sidebarRight.focus`（Workitem_01 引入）；
- 沙箱实测裁决 0.1.2 运行时是否提供 `remote.session` 服务（决定回退链真实覆盖面，README 矩阵随之修正）。

### 非目标

- 不重写 ModelMenu UI；只换数据源。

## 完成信号

- 0.1.5+0.19 沙箱：面板模型标签显示真实模型、菜单列出目录、切换生效；
- 0.1.2 档实测后回退链覆盖面有定论并写进 design.md；README 兼容矩阵与实际一致；
- probes 激活探测覆盖全部新面。

## 交付预期

一个 commit（fix: 模型面迁移 + 双版本回退链），归属 Delivery_01 的 MR。
