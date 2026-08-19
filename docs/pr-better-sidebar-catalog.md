# 发布材料：better-sidebar 推荐插件目录收录 PR

> 目标仓库：`omdsh-dev/DSH-better-sidebar`。收录后出现在设置页「添加 Tab 插件」弹窗。
> 前置：本仓库已 public 且打过 `dsh-plugin` / `dsh-better-sidebar` topic。

## 1. `src/client/plugins-tabs.ts` 追加条目（按字母序插在 dsh-git-remotes 与 dsh-sidebar-qa 之间）

```ts
  {
    id: 'dsh-sidechat',
    name: 'dsh-sidechat 侧边聊天',
    url: 'https://github.com/g-yixuan/dsh-sidechat',
    description: () => t('pluginSideChatDesc'),
    // dsh-sidechat hard-depends on dsh-better-sidebar (required peer), so
    // the install line installs the prerequisite first, then the plugin.
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-better-sidebar && dsh plugin --profile web add dsh-sidechat@latest',
  },
```

## 2. `src/client/locales.ts` 双语 key（加在 pluginSidebarQaDesc 附近）

中文（zh 区）：
```ts
  pluginSideChatDesc: 'Codex 风格侧边聊天与划选注释：从当前会话 fork 出独立侧边会话（归档隐藏、多实例、/side 命令、刷新恢复）；assistant 消息划选 → 编号角标 + 注解编辑器 →「N 条注释」chip 随消息发出，也可直接进入侧边聊天提问',
```

英文（en 区）：
```ts
  pluginSideChatDesc: 'Codex-style side chat & selection annotations: fork the current session into a persistent side panel (archived out of the session list, multi-instance, /side command, survives reload); select assistant text → numbered badges + note editor → an "N annotations" composer chip that rides your next message, or ask straight into a side chat',
```

## 3. PR 标题与正文草稿

标题：`feat(plugins): add dsh-sidechat to the tab-plugin catalog`

正文：
```markdown
收录一个新 Tab 插件：**dsh-sidechat**（Codex 风格侧边聊天 + 划选注释）。

- 仓库：https://github.com/g-yixuan/dsh-sidechat （已打 `dsh-plugin` / `dsh-better-sidebar` topic）
- 接入方式：消费 `ctx.betterSidebar`（`registerTab`，`inject = ['betterSidebar', ...]`），遵循 docs/external-plugin-guide.md
- npm：https://www.npmjs.com/package/dsh-sidechat
- 条目：plugins-tabs.ts 按字母序插入 + locales.ts 双语 pluginSideChatDesc
- 实测：`dsh plugin --profile web add dsh-better-sidebar@0.12.3` + 本插件在真实 DSH 挂载，Playwright 七条 journey lane 全绿（0.12.3 与 0.13.0 双版本）
```
