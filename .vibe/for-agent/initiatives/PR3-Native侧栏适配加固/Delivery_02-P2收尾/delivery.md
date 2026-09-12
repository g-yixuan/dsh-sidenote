# Delivery_02-P2收尾

## 上位约束

本 Delivery 遵循 [PR3-Native侧栏适配加固](../initiative.md)。

## 交付目标

修掉 PR #3 评审发现的 P2/P3 中仍值得做的项：native 下失明的三个消费点（/side 弹层聚焦列表、sideChatTargetTitle、标题编号）切换到 live registry 数据源；registry 插件级清理与 last-opened 语义；注释与测试补强。

## 交付边界

### 包含

- slash.ts / open.ts / model.ts 的 native 数据源切换；
- native.ts registry 生命周期与语义修正（ctx.effect 清理、last-opened 序号）；
- 注释修正（native.ts docstring、authority 包名、ModelMenu 引用）；
- 测试补强（open.ts 编排剩余分支、registry 交错场景）。

### 不包含

- rootContext 模块单例的架构重构（留贡献者讨论）；
- 长期宿主 API 线的实现（discussion-backlog 01）。

## Workitems

待本 Delivery 专项讨论并确认后补充；确认前不创建 `Workitem_XX-*` 目录。

## Git 交付

- repository：g-yixuan/dsh-sidenote
- branch：（待定）
- MR：（待创建）
- merged commit：（待合入）
