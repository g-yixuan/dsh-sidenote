<p align="center">
  <picture>
    <source media="(max-width: 640px)" srcset="docs/assets/hero-compact.svg">
    <img src="docs/assets/hero.svg" alt="dsh-sidenote：思路可以分岔，主线始终向前。划选批注、侧边聊天与结论回流。" width="100%">
  </picture>
</p>

<p align="center">
  为 <b>DeepSeek Harness</b> 加上侧边聊天与划选注释。<br>
  读到一个疑问，就在旁边聊透；有了结论，再带回正在推进的任务。
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#看看它如何工作">功能演示</a> ·
  <a href="docs/usage.md">使用指南</a> ·
  <a href="README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-sidenote"><img src="https://img.shields.io/npm/v/dsh-sidenote?color=3B5BFD&amp;label=npm" alt="npm version"></a>
  <a href="https://github.com/g-yixuan/dsh-sidenote/actions/workflows/ci.yml"><img src="https://github.com/g-yixuan/dsh-sidenote/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-60708E" alt="MIT license"></a>
</p>

![划选文字后可添加到对话或在侧边提问；同屏展示侧聊回答、待发送的批注与回流标签，以及已发送消息中的上下文气泡](docs/assets/workflow.jpg)

<p align="center"><sub>dsh-sidenote 0.7.2 · DSH 0.2.1-rc.2 · DeepSeek V4.1 Flash · 真实交互录制</sub></p>

## 安装

在已安装 DSH 的环境中执行：

```bash
dsh plugin --profile web add dsh-sidenote
```

打开 DSH Web，点击会话顶栏的 **「侧边」**，或划选一段回复开始。也可输入 `/side` 打开侧聊，用 `Alt+S` 切换主、侧输入焦点。

主线维护 DSH **0.2.2 系列（rc.1 起）**，复用宿主原生聊天界面。已验证 0.2.2-rc.1，同系列后续 RC 和正式版允许安装，验收记录按精确版本更新。DSH 0.2.2 需要 Node.js 24.9 或更新版本。此范围从插件 0.8.3 起生效，0.8.2 支持 0.2.1 系列。DSH 0.2.1 固定 `dsh-sidenote@0.8.2`，0.2.0-rc.2 固定 `dsh-sidenote@0.7.6`，更早宿主固定各自最后兼容包，详见[兼容政策](docs/compatibility.md)。

## 一个任务，容得下更多思路

### 有疑问，在旁边聊透

评审方案时想追问一个细节，读代码时想弄清一种实现，都可以从当前对话开一个侧聊。**完整历史随 fork 保留**，不用再交代一遍背景。

### 有想法，直接落在原文上

划选主对话或侧聊中的一段回复，写下问题或修改意见。**原文和注释一起保留**，可累积多条，发送前预览、移除，正文草稿照常编辑。

读到「提示“未找到”，并给出放宽条件建议」，就选中这一句，追问「给一版可直接使用的空状态」。

### 有结论，带回正在做的事

点击侧聊回答操作栏右侧的「带回主对话」图标，**问题与回答成对带回**，出现在主输入框上方，随下一条消息送入主线。也可以整段回流，或将值得保留的侧聊保存为正式会话。

## 看看它如何工作

**划选一句 → 带着上下文追问 → 把结论带回主线。**

![真实 Flash 演示：划选批注、悬浮查看与编辑、侧聊追问、图标回流，以及发送后的气泡内引用](docs/assets/demo.gif)

[观看清晰版 MP4](docs/assets/demo.mp4) · [查看静态截图](docs/assets/workflow.jpg)

<sub>2026-10-25 录制于 dsh-sidenote 0.7.2 / DSH 0.2.1-rc.2。以笔记搜索设计为例，真实调用官方 DeepSeek V4.1 Flash 生成回答；约 43 秒的录屏展示实际操作与完整回复过程。<a href="docs/assets/README.md">素材说明</a></sub>

## 用起来顺手的细节

| 你关心的事 | Sidenote 如何处理 |
|---|---|
| 同时探索几个问题 | 右栏可开多个独立侧聊标签，随时切换，也可重开已关闭的原会话。 |
| 之前聊过的内容 | 侧聊继承完整历史，默认折叠，按需展开。 |
| 侧聊的输入开销 | 支持上下文缓存复用，减少缓存命中部分的输入开销。 |
| 熟悉的聊天体验 | 输入框与消息展示对齐原生体验，支持图片、工具卡和面板内审批。 |
| 一次有多处意见 | 多条注释可以一起发送，也能逐条预览和移除。 |
| 发不出去怎么办 | 发送失败保留注释与正文，便于重试。 |
| 刷新后继续 | 保留侧聊问答与上下文分区；侧栏未恢复时，可从 `/side` 重开。 |
| 不想让支线堆满列表 | 侧聊默认不进入会话列表和搜索，保存为正式会话后才列出。 |
| 结论值得长期保留 | 保存为正式会话，后续继续讨论。 |

官方侧栏中的 Markdown、纯文本／代码、带文本层的 PDF 和 Word／PPT 预览也可划选摘录，直接累积到主对话的「文档引用」，随下一条消息发送。保留文件来源和 PDF 页码，不在文档上留下角标；浏览器和扫描文档暂不支持。

具体操作、恢复行为和划选范围见[使用指南](docs/usage.md)。

## 兼容与帮助

维护窗口覆盖 **当前 RC／正式版系列，可额外准入一个 alpha 系列**，侧聊共用原生 Conversation。新增 alpha 系列经完整验收准入，当前 RC 系列继续维护。日常 PR 检查每个系列的最低版和最新已验证版，每日探测 latest／next／alpha 通道及窗口内新增宿主，每周回归全部窗口内版本。当前系列滚动后，退出的旧系列固定最后兼容插件。详见[兼容与维护政策](docs/compatibility.md)；公开安装以对应 Release 为准。

遇到问题或有改进建议，欢迎[反馈](https://github.com/g-yixuan/dsh-sidenote/issues/new/choose)，附上 DSH 与插件版本、复现步骤或截图。

## 一起完善 Sidenote

欢迎补充使用反馈、复现问题、改进文档和提交代码，中文与 English 都可以。开发环境、命令和检查步骤见[贡献指南](CONTRIBUTING.md)。

[仓库维护](docs/maintaining.md) · [发布指南](docs/releasing.md) · [MIT License](LICENSE)
