# dsh-side-chat

DSH web 插件：Codex 风格的**侧边聊天**与**划选注释**。[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的薄消费插件（thin consumer），通过 `ctx.betterSidebar` 服务注册侧边栏 Tab。

## 功能

### 侧边聊天

从当前主会话 fork（全量历史快照）出独立的侧边会话，在 better-sidebar 右侧栏的「侧边」Tab 里多轮对话：

- 右侧栏 `+` 菜单 →「侧边聊天」打开（或斜杠命令 `/side`）；
- fork 时刻带主会话完整上下文，之后两个会话各自独立演进；
- 可多实例并存（「侧边」「侧边 2」…），各自独立关闭；
- 模型跟随主会话当前选择（fork 时同步）；
- 持久化：刷新/重启后随布局恢复；不进左侧会话列表（归档隐藏）；仅手动关闭 Tab 从界面消失（会话 jsonl 留盘不可见）。

### 划选注释

在 assistant 消息上划选文本：

- 「添加到对话」：选中文本高亮 + 蓝色编号角标 + 注解编辑器（可空注解）；主输入框出现「N 条注释」chip，全部存活注释随下一条消息作为引用上下文发出；
- 「在侧边聊天中提问」：注解编辑后引用+注解直接进入侧边聊天输入框；
- 点角标可重开编辑器修改/删除；编号按创建顺序、删除不重排；页面级生命周期（刷新即失）。

## 安装

```bash
dsh plugin --profile web add dsh-side-chat
```

本地开发挂载：`dsh plugin --profile web add link:<本仓库路径>`（client 改动热重载，host 改动需重启 `dsh web`）。

## 开发

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest 纯函数单测 |
| `pnpm build` | 类型声明 + tsdown（host ESM + client CJS bundle，纯度门） |
| `pnpm test:mount` | 挂载冒烟：scratch profile + 伪造会话 jsonl + 真实 `dsh web` + Playwright 六条 journey lane |

设计文档与执行空间见父目录 `dsh_project/.vibe/for-agent/initiatives/侧边聊天与划选注释/`。

## License

MIT
