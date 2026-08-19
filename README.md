# dsh-sidechat

DSH（DeepSeek Harness）web 插件：Codex 风格的**侧边聊天**与**划选注释**。[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的薄消费插件（thin consumer），通过 `ctx.betterSidebar` 服务注册侧边栏 Tab。

[English](README_EN.md) · 中文

## 功能一览

### 💬 侧边聊天

从当前主会话 **fork**（全量历史快照）出独立的侧边会话，在右侧栏的「侧边」Tab 里多轮对话——主线思路不打断，支线问题随手开：

- 右侧栏 `+` 菜单 →「侧边聊天」，或斜杠命令 `/side`；
- fork 时刻带主会话完整上下文，之后两个会话各自独立演进；
- 多实例并存（「侧边」「侧边 2」…），各自独立关闭；
- 模型跟随主会话当前选择（fork 时同步）；
- 持久化：刷新/重启后随布局恢复；不进左侧会话列表（归档隐藏）；仅手动关闭 Tab 从界面消失。

![侧边聊天面板](docs/assets/04-side-chat-panel.png)

### 🗒️ 划选注释

在 assistant 消息上划选文本，把「引用 + 你的注解」变成发送给模型的上下文：

- **添加到对话**：选中文本高亮 + 蓝色编号角标 + 注解编辑器（可空注解）；主输入框出现「N 条注释」chip，全部存活注释随下一条消息发出；
- **在侧边聊天中提问**：注解编辑后引用 + 注解直接进入侧边聊天输入框；
- 点角标可重开编辑器修改/删除；编号按创建顺序、删除不重排；页面级生命周期（刷新即失）。

| 划选浮层 | 注解编辑器 | 角标 + 注释 chip |
|---|---|---|
| ![划选浮层](docs/assets/01-selection-popover.png) | ![注解编辑器](docs/assets/02-annotation-editor.png) | ![角标与注释 chip](docs/assets/03-badge-and-chip.png) |

## 安装

前置：已安装 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（本插件的硬依赖）。

```bash
dsh plugin --profile web add dsh-sidechat
```

本地开发挂载：`dsh plugin --profile web add link:<本仓库路径>`（client 改动热重载，host 改动需重启 `dsh web`）。

## 设计要点

- **真 fork，不压缩**：侧边会话是真实 DSH 会话（fork 全量历史），拥有与主会话对等的能力（工具调用、继续深挖、再 fork）；不是「压缩成摘要 + 一次性问答」。
- **列表卫生**：侧边会话归档隐藏，左侧列表永远干净。
- **可累积的标注工作流**：多次划选累积多条注释，编辑、删除、随消息一起发出——不是一次性单引文。

## 开发

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest 纯函数单测 |
| `pnpm build` | 类型声明 + tsdown（host ESM + client CJS bundle，纯度门） |
| `pnpm test:mount` | 挂载冒烟：scratch profile + 伪造会话 jsonl + 真实 `dsh web` + Playwright 七条 journey lane（支持 `BS_VERSION` 切换 better-sidebar 版本做前向兼容验证） |

## License

MIT
