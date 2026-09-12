# PR3-Native侧栏适配加固

## 职责

负责 dsh-sidenote 在 better-sidebar ≥ 0.19（native 右栏）与 dsh 0.1.5 时代的适配质量收尾：合入社区 PR #3 后，把评审发现的 P1/P2 问题修完，守住 README 声明的兼容矩阵。

## 目标

- PR #3 列出的三个已修复面（开 tab、归档、fork 模型同步）保持可用；
- 评审发现的 P1 静默失效面（聚焦、重开、forking 相位草稿、模型标签/菜单/切换、老宿主模型同步回退）全部修复或显式降级；
- 每个修复带回归测试；修复在 0.1.5+0.19 沙箱与 0.1.1+0.17 legacy 环境双侧验证。

## 范围与非目标

### 范围

- `src/client/sidechat/`（open.ts / lifecycle.ts / SideChatPanel.tsx / native.ts / slash.ts）与 `src/client/host/probes.ts` 的跟修；
- 向 dsh-better-sidebar 上游提 issue（`SidebarSurface.activate` 空操作、native onClose 丢 meta）；
- 测试补齐：open.ts 编排层、forkAndRegister 模型同步路径。

### 非目标

- 不重写 PR #3 已验证可用的主路径（seed.meta、root ctx 重路由、live registry 骨架）；
- 不做 live registry 的架构重构（rootContext 传参化等口味项留给贡献者讨论，不主动动）；
- 不替上游实现宿主 API（只提 issue；长期路线见 discussion-backlog 01）。

## Delivery 骨架

- `Delivery_01-P1跟修`：五个 P1（聚焦 no-op、reopen 三重死亡、forking 草稿丢失、模型面迁移、老宿主回退链）+ 同文件的低成本正确性项（createSideChat 诚实返回、双开竞态）+ 对应回归测试。一个 MR。
- `Delivery_02-P2收尾`：slash 弹层聚焦列表 / sideChatTargetTitle / 标题编号的数据源切换、registry 插件级清理、probes 补登之外剩余的注释与测试补强。一个 MR。

## 推进顺序

Delivery_01 → Delivery_02。

## 全局约束

- 仓库分层纪律：L2（面板）不直接碰宿主 RPC，宿主接线集中在 lifecycle.ts；
- off-face 纪律：就地 feature-check + 吞错降级 + 登记 `host/probes.ts`；
- 双版本探测链惯例（`chatSourceOf` 范本）：宿主面迁移必须留旧面回退，不弃旧档；
- 注释纪律：解释 why、authority 引用到文件路径级；
- 验证环境：0.1.5-rc.2+0.19.x 沙箱（独立 DSH_HOME/端口）+ 日常 0.1.1+0.17.1 legacy 实例（link: 直连，build 前注意影响）。

## 整体完成条件

- Delivery_01/02 的 MR 均合入；
- README 兼容矩阵与实际能力一致（若 0.1.1 档无法激活则修正矩阵，不留虚档）；
- discussion-backlog 01 的宿主 API 诉求清单沉淀为上游 issue。
