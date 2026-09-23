<p align="center">
  <img src="docs/assets/banner.png" alt="dsh-sidenote —— 侧边开一岔对话，划选留一条注释，主线永不被打断" width="100%">
</p>

<p align="center">
  DSH（DeepSeek Harness）插件——支线问题不打断主线，结论一键回流。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-sidenote"><img src="https://img.shields.io/npm/v/dsh-sidenote" alt="npm version"></a>
  <a href="https://github.com/g-yixuan/dsh-sidenote/actions/workflows/ci.yml"><img src="https://github.com/g-yixuan/dsh-sidenote/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/peer-none-informational" alt="no required peer dependencies">
</p>

<p align="center">
  <a href="README_EN.md">English</a> · <b>中文</b>
</p>

![演示：划选注释 → 侧边聊天 → 回流主线](docs/assets/demo.gif)

## 安装

```bash
dsh plugin --profile web add dsh-sidenote
```

**一步直装，无前置依赖。** 装完顶栏点「侧边」，或直接划选任意回复文本。

本地开发挂载：`dsh plugin --profile web add link:<本仓库路径>`（client 改动热重载，host 改动需重启 `dsh web`）。

## 侧边聊天——支线问题不打断主线

从当前主会话 **fork**（全量历史快照，不压缩）出独立侧边会话，在右侧栏多轮对话：

- 顶栏「侧边」按钮 / 右侧栏 guide / 斜杠命令 `/side` 三个入口；
- 与主对话**同一套渲染材质**：工具卡、思考预览、任务卡、模型/权限切换、`@` 引用、图片附件；
- 审批/提问**在面板内直接答复**，不用跳回主视图；跑完有 toast 通知；
- 继承历史默认折叠成指示卡；折叠态/滚动位置刷新不丢；`Alt+J` 主↔侧切焦点。

![侧边聊天面板：fork 历史 + 原生级工具卡 + 同能力 composer](docs/assets/04-side-chat-panel.png)

## 回流主线——侧边结论不烂在支线

- 侧边结论一键「回流到主会话」：**问答成对**（结论 + 它回答的问题）收为受控 chip 挂在主输入框上方，随下一条消息发给主线；`@` 也可直接引用侧边聊天；
- 「保存为正式会话」转正进会话列表；`/side` 弹层重开最近关闭。

![回流 chip：侧边结论挂进主输入框](docs/assets/06-reflow-chip.png)

## 划选注释——把「这句有问题」变成模型的上下文

- 划选 assistant 回复 → 浮层 → 注解编辑器，右缘编号角标锚定原文；
- 注释是受控对象（可预览、可逐条移除），**草稿零污染**——发送瞬间才序列化为模型可读的结构化协议块；
- 发送后气泡收成「批注 ×N」标签留痕；刷新不丢。

| 划选浮层 | 注解编辑器 |
|---|---|
| ![划选浮层](docs/assets/01-selection-popover.png) | ![注解编辑器](docs/assets/02-annotation-editor.png) |


<details>
<summary><b>更多截图</b></summary>

| 折叠态（继承卡 + 操作行） | 侧边斜杠菜单 |
|---|---|
| ![折叠态](docs/assets/04a-side-chat-collapsed.png) | ![斜杠菜单](docs/assets/04b-side-slash-menu.png) |

| 角标 + 注释 chip | 发送后留痕 |
|---|---|
| ![角标与注释 chip](docs/assets/03-badge-and-chip.png) | ![发送后留痕](docs/assets/05-sent-trace.png) |

</details>

## 兼容性

| DSH | dsh-better-sidebar | 行为 |
|---|---|---|
| ≥ 0.1.5-rc.1 | 任意（无需安装） | **直连 DSH 原生右侧边栏** |
| ≤ 0.1.2-rc.x | ≤ 0.18.x（必需） | legacy 布局承载 |

宿主面缺席时插件按能力降级（不崩页面）；与 dsh-better-sidebar 天然共存（各自注册、互不依赖）。

**单实例语义（直连腿）**：受宿主「page kind 每 pane 单实例」规则约束——同一会话同时只开一个侧边聊天（再次打开/新建 = 聚焦既有 tab；关闭后可经 /side 重开恢复原会话）。多开诉求可用原生侧栏的分栏（每 pane 一个），多实例将随宿主 `multiple` 能力（0.1.6）恢复。

## 设计要点

- **真 fork，不压缩**：侧边会话是真实 DSH 会话（全量历史快照），与主会话能力对等；不是「摘要 + 一次性问答」。
- **列表卫生**：侧边会话归档隐藏，会话列表永远干净。
- **可累积的标注工作流**：多次划选累积多条注释，编辑、删除、随消息一起发出——不是一次性单引文。

## 开发

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest 单测（222 例） |
| `pnpm build` | 类型声明 + tsdown（host ESM + client CJS bundle，纯度门） |
| `pnpm test:mount` | 挂载冒烟：真实 `dsh web` + 伪造会话日志 + Playwright 十条 journey lane（`BS_VERSION`/`DSH_CMD` 切版本矩阵） |

问题与建议欢迎 [Issue](https://github.com/g-yixuan/dsh-sidenote/issues)。

## 发版

发布走 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（OIDC）：**不需要 npm token，不需要 OTP，本地不需要登录 npm**。`.github/workflows/release.yml` 拿 GitHub Actions 的 OIDC 身份直接换发布权限，并附 SLSA provenance。

> **触发条件是「发布一个 GitHub Release」，不是推 tag。**
> 只 `git push --tags` 不会发布任何东西——tag 会静静躺在那里。

```bash
# 1. 改 package.json 的 version，提交
git commit -am "release: vX.Y.Z——<摘要>"

# 2. 打 tag 并推送（这一步还没有发布）
git tag vX.Y.Z && git push origin main --tags

# 3. 创建 GitHub Release —— 这一步才真正触发发布
gh release create vX.Y.Z --title "vX.Y.Z — <标题>" --notes-file <notes.md>
```

workflow 随后自动跑 build → typecheck → test → `pnpm publish --provenance`，并校验 tag 与 `package.json` 版本一致（不一致直接失败）。

几个已知的坑：

- **registry 有复制延迟**：workflow 显示 `✅ Published` 后，`npm view` 仍可能有 1–5 分钟看到旧版本（Fastly `max-age=300`）。以 workflow 日志为准，不要据此判断失败而重试。
- **别去折腾 npm token**：npm 正在[系统性废止 bypass-2FA 的 granular token](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)。本仓库不依赖任何 token，发布失败请先看 workflow 日志，而不是 token 配置。
- **CI 的 `plugin-mount` lane 失败不阻塞发版**：那是独立 workflow，Release 流程只跑单测，不跑 e2e。

## License

MIT
