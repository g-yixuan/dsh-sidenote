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
- 添加到主对话或侧边聊天都保存为同一类受控注释，使用同一套 chip 预览、逐条移除及批量清空；引用和注解全文保留，**草稿零污染**，可只发送引用；
- 新建注解点击编辑器外部或按 Enter 保存，Esc 明确取消；主→侧先等待选定 Tab 的真实子会话，等待期间可按 Esc 取消，失败则保留注解并提示重试；
- 通过宿主原生输入机发送，保留 `@` 引用、图片附件和队列/steer 仲裁；目标会话出现持久消息或真实队列记录后，这一批注释才标为已发送，气泡收成「批注 ×N」留痕；
- 保存的注释按目标会话隔离；存储不可用时提示仅保存在内存。发送失败保留注释与正文，提交期间新增或修改的注释留给下一条消息。
- 侧边 assistant 正文也支持局部划选、多段落、列表与代码引用，入口只向所在侧聊添加；继承历史同样归当前子会话。流式、跨消息、思考和控件不作为引用。角标与高亮跟随来源消息并裁剪到其可见区域；原文折叠时注释仍在 chip 中。
- 已保存注释刷新后保留。宿主恢复原生 tab 时重新绑定原子会话；未恢复侧栏时，可用 `/side` 中的“重开”恢复原子会话及注释。新建 fork 使用自己的独立注释列表。

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

维护范围按精确组合列在[兼容与维护政策](docs/compatibility.md)：0.1.7 当前维护，0.1.5 延长维护，0.1.1/0.1.2 的三组旧路径冻结且保留必需验收，0.2.0-rc.2 已通过精确准入并纳入当前维护。未列组合不作已验证承诺；安装引擎范围不代表其中所有版本均兼容。

顶栏“兼容状态”可查看、重查或导出当前接入状态。服务尚未就绪不等于不兼容；明确受限时保留正文、附件与注释。无法读取的宿主版本显示未知，导出不包含用户正文、凭证或本机路径。

原生右栏无需 BS；旧版依赖表中的 BS 组合。原生 page kind 每 pane 一个，分栏可容纳多个 pane；普通入口聚焦既有 tab，关闭后 `/side` 重开原 child。其他 BS 共存或未来 `multiple` 能力需单独验收。

## 设计要点

- **真 fork，不压缩**：侧边会话是真实 DSH 会话（全量历史快照），与主会话能力对等；不是「摘要 + 一次性问答」。
- **列表卫生**：侧边会话归档隐藏，会话列表永远干净。
- **可累积的标注工作流**：多次划选累积多条注释，编辑、删除、随消息一起发出——不是一次性单引文。

## 开发

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest 单测（先运行 build） |
| `pnpm build` | 类型声明 + tsdown（host ESM + client CJS bundle，纯度门） |
| `pnpm test:mount` | 真实 `dsh web` + 种子会话 + Playwright 挂载与交互验收（`BS_VERSION`/`DSH_CMD` 切版本矩阵） |

## 参与贡献

欢迎报告问题、提出需求、协助复现、改进文档和提交代码。请从 [Issue 入口](https://github.com/g-yixuan/dsh-sidenote/issues/new/choose) 或[贡献指南](CONTRIBUTING.md)开始；中文和 English 都可以。

维护者见[仓库维护](docs/maintaining.md)和[发布指南](docs/releasing.md)。

## License

MIT
