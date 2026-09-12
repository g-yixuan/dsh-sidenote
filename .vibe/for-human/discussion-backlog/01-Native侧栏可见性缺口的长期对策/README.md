# Native 侧栏可见性缺口的长期对策

## 起因

PR#3（fix: support better-sidebar 0.19 native right sidebar）评审中发现，一串问题共享同一根因：better-sidebar ≥ 0.19 把右栏 tab 托管给 DSH 原生侧边栏后，**插件对自己 tab 的可见性/控制力大幅收缩**：

- `surface.activate(tabId)` 是纯 no-op（只 `return records.has(tabId)`），插件无法聚焦既有 native tab；
- 用户点 × 关闭 native tab 不经过插件的 `descriptor.onClose`（`tab-adapter.tsx` 卸载只 `records.drop`）；程序化 closeTab 虽回调但丢 `meta`；
- native tab 不进布局快照 → 标题编号、`/side` 弹层聚焦列表、`sideChatTargetTitle` 预览全部失明；
- dsh sidebar-right 对 page kind 有 `held` 分支（同 pane 同 kind 强制聚焦既有 tab），多实例语义在 native 面塌缩。

PR#3 的 live registry（面板挂载自登记）是应用层补丁的第一块砖；Initiative `PR3-Native侧栏适配加固` 里全是同类补丁。

## 待讨论

1. **继续补丁线还是推宿主 API 线？** 补丁线每处都要猜宿主行为，脆弱且跟随宿主版本抖动；宿主 API 线（向 dsh-better-sidebar / dsh 提 issue/PR：activate 接 `controller.focus`、onClose 带 meta、tab 枚举面）一劳永逸但受制于上游节奏。
2. **live registry 的边界**：它该长成"插件自己的 native tab 注册表"（标题、meta、生命周期全接管），还是只补宿主实在给不了的最小集？
3. **多实例语义**：dsh native 侧栏 page kind 每 pane 单实例的 `held` 模型，与侧聊"多实例一等公民"冲突——绕（换 kind 形态？）还是接受？
4. 若走宿主 API 线：需要哪些面、先提哪个、在哪个仓库提（better-sidebar 的 `SidebarSurface` 抽象层 vs dsh 的 `ISidebarRight`）。

## 当前状态

短期补丁已在 Initiative `PR3-Native侧栏适配加固` 执行（含向 better-sidebar 提 activate issue 的动作项）。本议题只承载长期路线的讨论。
