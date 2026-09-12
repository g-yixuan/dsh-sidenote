# Workitem_01-Native编排修复

## 上位约束

本 Workitem 遵循 [Delivery_01-P1跟修](../delivery.md)。

## 目标

让 open.ts 的三条编排路径（open-or-focus / create / reopen）在 native 宿主上的行为与文档语义一致：聚焦真实发生、重开真实恢复、草稿不丢、失败不谎报成功。

## 范围与非目标

### 范围

- `openOrFocusSideChat` native 分支：`activateTab` 空操作问题，改走 `sidebarRight.focus` 探测（off-face，缺席则如实降级）；
- `reopenSideChat` native 适配：seed.meta 携带 `{childId, parentSessionId}`；关闭记录源补到 panel 卸载钩子（native 限定）；slash.ts 失败路径反馈；
- `SideChatPanel` seedDraft 相位门：非 chat 相位落 `meta.pendingDraft`；
- openTab→mount 窗口的双开竞态：in-flight 标记去重；
- `createSideChat` 诚实返回：openTab 前查 `isTabEnabled` 等已知静默失败面。

### 非目标

- slash 弹层聚焦列表 / sideChatTargetTitle / 标题编号的数据源改造（Delivery_02）；
- 上游 better-sidebar 的修复（仅提 issue，fork 分支作参考实现）。

## 完成信号

- 0.1.5+0.19 沙箱实测：既有侧聊可被聚焦、划选草稿到达前台 tab；关闭后可从 /side 重开且恢复原子会话；forking 窗口内投递的草稿不丢；双击不双开。
- open.ts 编排层新增单测覆盖 native 三分支。
- 日常 legacy 环境（0.1.1+0.17.1）build 后行为无回归。

## 交付预期

一个 commit（fix: native 编排 P1 修复），归属 Delivery_01 的 MR。
