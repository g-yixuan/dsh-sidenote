# dsh-sidenote

DSH（DeepSeek Harness）web 插件：Codex 风格的**侧边聊天**与**划选注释**。[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的薄消费插件（thin consumer），通过 `ctx.betterSidebar` 服务注册侧边栏 Tab。

[English](README_EN.md) · 中文

<video src="https://raw.githubusercontent.com/g-yixuan/dsh-sidenote/main/docs/assets/demo.mp4" controls muted loop playsinline width="100%"></video>

## 功能一览

### 💬 侧边聊天

从当前主会话 **fork**（全量历史快照）出独立的侧边会话，在右侧栏的「侧边」Tab 里多轮对话——主线思路不打断，支线问题随手开：

- 顶栏常驻「侧边」按钮、右侧栏 `+` 菜单、斜杠命令 `/side`（中文 `/侧边`）三个入口；
- fork 时刻带主会话完整上下文，之后两个会话各自独立演进；
- 多实例并存（「侧边」「侧边 2」…），各自独立关闭；
- 模型跟随主会话当前选择（fork 时同步）；
- 持久化：刷新/重启后随布局恢复；不进左侧会话列表（归档隐藏）；仅手动关闭 Tab 从界面消失；
- **回流通道**：侧边结论一键「回流到主会话」——结论以受控上下文 chip 挂在主输入框上方，随下一条消息发给主线（Cursor 级能力，Codex 没有）。

![侧边聊天面板](docs/assets/04-side-chat-panel.png)

### 🗒️ 划选注释

在 assistant 消息上划选文本，把「引用 + 你的注解」变成发送给模型的上下文：

- **添加到对话**：选中文本高亮 + 右缘编号角标 + 注解编辑器（可空注解）；主输入框上方出现「N 条注释」chip（可预览、可逐条移除）；
- **在侧边聊天中提问**：注解编辑后引用 + 注解直接进入侧边聊天输入框；
- **草稿零污染**：注释是受控对象，不进输入框文本流；发送瞬间才序列化为结构化 XML 协议块（`<annotation>` 块，模型可读性最佳形态）；
- **发送后留痕**：已发消息气泡收成「批注 ×N」标签可回看；原文角标转空心只读态；**刷新不丢**（按会话持久化，随点随恢复锚定）。

| 划选浮层 | 注解编辑器 | 角标 + 注释 chip |
|---|---|---|
| ![划选浮层](docs/assets/01-selection-popover.png) | ![注解编辑器](docs/assets/02-annotation-editor.png) | ![角标与注释 chip](docs/assets/03-badge-and-chip.png) |

| 发送后留痕（气泡收成标签） | 侧边回流 chip |
|---|---|
| ![发送后留痕](docs/assets/05-sent-trace.png) | ![侧边回流 chip](docs/assets/06-reflow-chip.png) |

## 安装

前置：已安装 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（本插件的硬依赖）。

```bash
dsh plugin --profile web add dsh-sidenote
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
