# Workitem_01 design

## 源码事实（评审期核实，authority 到文件行号）

- better-sidebar 0.19.1 `src/client/native/surface.ts:139-144`：`activate(tabId)` 只 `return records.has(tabId)`，不聚焦；注释自承 "a tab is focused by opening its (kind, address) again"。
- 同文件 `close(sessionId, tabId)` 返回 `{ type, title }`——无 meta；`service.ts` closeTab native 分支回调 `onClose({id, type, title})`。
- `tab-adapter.tsx:288`：用户点 × 关 native tab，卸载 effect 只 `records.drop`，**不触发** `descriptor.onClose`。
- dsh 0.1.5 `dsh-client-ui-sidebar-right`：`ctx.sidebarRight: ISidebarRight` 有 `focus(tabId)`（compat agent 读产物实证，client.js L1337-1341 接 `actions.focusTab`）。
- `openTab` 静默失败面：`isTabEnabled` false / descriptor 缺失 / targetSessionId 缺失 → warn 后 return（service.ts openTab 开头）。

## 方案

1. **聚焦**：`openOrFocusSideChat` native 分支在 `activateTab` 之外补探测 `ctx.get('sidebarRight')?.focus(tabId)`（off-face，feature-check + 降级保持 activateTab 调用）。不按宿主版本分派，探测优先。
2. **reopen**：`reopenSideChat` 改 seed.meta 携带 `{childId, parentSessionId}`（native 面证实采纳）；`created === undefined` 时按 `nativeSidebarHost(ctx)` 返回。
3. **关闭记录源**：`SideChatPanel` 注册 `registerLiveSideChat` 的 disposer 里补 `recordClosedSideChat`（仅 native host；legacy 由 onClose 负责）。注册时反向 `dropClosedSideChat`（自愈重挂载误记）。
4. **seedDraft 相位门**：panel 内 seedDraft 回调检查 `phaseRef.current === 'chat'`；否则 `updateTabMeta` 写 `pendingDraft`（复用既有相位等待机制）。
5. **双开竞态**：`native.ts` 加 per-session in-flight 标记（createSideChat 设置、registerLiveSideChat 消费、TTL 兜底）；窗口内第二次 openOrFocus 携带的草稿存入 pendingSeeds，注册时回放。
6. **诚实返回**：`createSideChat` openTab 前探测 `isTabEnabled(SIDE_TAB_TYPE)`（off-face cast）；`created === undefined` 分支保留 `nativeSidebarHost` 判断但前置已知失败面排除。

## 约束

- L2 不直接碰宿主 RPC；新探测面登记 probes 的工作在 Workitem_02（本 Workitem 的 sidebarRight.focus 一并由 Workitem_02 统一登记，避免双写冲突）——不，改为各自登记自己引入的面：本 Workitem 登记 sidebarRight.focus。
- 注释到 why + authority 文件路径级。
