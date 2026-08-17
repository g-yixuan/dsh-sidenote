# dsh-side-chat

DSH web 插件：Codex 风格的**侧边聊天**与**划选注释**。[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的薄消费插件（thin consumer），通过 `ctx.betterSidebar` 服务注册侧边栏 Tab。

- **侧边聊天**：从当前主会话 fork（全量历史快照）出独立侧边会话；多轮对话、多实例并存（「侧边 N」）；持久化——刷新/重启后随布局恢复；不进左侧会话列表（归档隐藏）；仅手动关闭 Tab 从界面消失。
- **划选注释**：在 assistant 消息上划选 → 「添加到对话 / 在侧边聊天中提问」→ 高亮 + 编号角标 + 注解编辑器 → 输入框「N 条注释」chip 随消息发出。

## 安装

```bash
dsh plugin --profile web add dsh-side-chat
```

本地开发：`pnpm install && pnpm build`，然后在 profile 里 `link:` 挂载。

## 开发

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest |
| `pnpm build` | 类型声明 + tsdown（host ESM + client CJS bundle，纯度门） |

设计文档与执行空间见 `.vibe/for-agent/initiatives/侧边聊天与划选注释/`（在父目录 dsh_project 下）。

## License

MIT
