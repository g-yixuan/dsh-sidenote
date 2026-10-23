<p align="center">
  <picture>
    <source media="(max-width: 640px)" srcset="docs/assets/hero-compact.svg">
    <img src="docs/assets/hero.svg" alt="dsh-sidenote：思路可以分岔，主线始终向前。划选注释、侧边追问，再把结论带回来。" width="100%">
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

![新版浅色界面：左侧保留主对话，右侧深入讨论，结论回到主输入框](docs/assets/workflow.jpg)

<p align="center"><sub>dsh-sidenote 0.6.0 · DSH 0.2.0-rc.2 · 原生侧栏 · 浅色主题</sub></p>

## 安装

在已安装 DSH 的环境中执行：

```bash
dsh plugin --profile web add dsh-sidenote
```

打开 DSH Web，点击会话顶栏的 **「侧边」**，或划选一段回复开始。也可输入 `/side` 打开侧聊，用 `Alt+S` 切换主、侧输入焦点。

当前主线支持 DSH 0.2.0-rc.2 / 0.2.1-rc.2，无需安装 `dsh-better-sidebar`。旧宿主固定最后兼容的 `dsh-sidenote@0.6.4`，具体命令见[兼容政策](docs/compatibility.md)。

## 一个任务，容得下更多思路

### 有疑问，在旁边聊透

评审方案时想追问一个细节，读代码时想弄清一种实现，都可以从当前对话开一个侧聊。**完整历史随 fork 保留**，不用再交代一遍背景。

侧聊有独立的多轮对话、工具卡、模型和权限切换，也支持图片、`@` 引用以及面板内审批。主线和支线各自推进。

### 有想法，直接落在原文上

划选主对话或侧聊中的一段回复，写下问题或修改意见。**原文和注释一起保留**，可累积多条，发送前预览、移除，正文草稿照常编辑。

读到「没有结果时，引导用户调整搜索词」，就选中这一句，追问「这里如何设计才不会让用户卡住？」。

### 有结论，带回正在做的事

侧聊回答下点击「回流到主会话」，**问题与回答成对带回**，出现在主输入框上方，随下一条消息送入主线。也可以整段回流，或将值得保留的侧聊保存为正式会话。

## 看看它如何工作

**划选一句 → 带着上下文追问 → 把结论带回主线。**

![浅色主题操作录屏：划选原文、添加问题、发送到侧边聊天、回流结论](docs/assets/demo.gif)

[观看清晰版 MP4](docs/assets/demo.mp4) · [查看静态截图](docs/assets/workflow.jpg)

<sub>以上素材重新录制于 dsh-sidenote 0.6.0 / DSH 0.2.0-rc.2。使用隔离环境中的示例对话与本地演示模型，展示真实界面操作；内容与回答为合成示例。</sub>

## 用起来顺手的细节

| 你关心的事 | Sidenote 如何处理 |
|---|---|
| 之前聊过的内容 | 侧聊继承完整历史，默认折叠，按需展开。 |
| 一次有多处意见 | 多条注释可以一起发送，也能逐条预览和移除。 |
| 发不出去怎么办 | 发送失败保留注释与正文，便于重试。 |
| 刷新后继续 | 已保存的注释保留；侧栏未恢复时，可从 `/side` 重开原侧聊。 |
| 不想让支线堆满列表 | 侧聊默认不进入会话列表和搜索，保存为正式会话后才列出。 |
| 结论值得长期保留 | 保存为正式会话，后续继续讨论。 |

具体操作、恢复行为和划选范围见[使用指南](docs/usage.md)。

## 兼容与帮助

当前主线维护 **DSH 0.2.0-rc.2、0.2.1-rc.2** 两个精确宿主版本，侧聊直接复用原生 Conversation。窗口外用户停留在最后兼容的插件 0.6.4，当前主线不再逐个回补新功能或运行旧宿主检查。支持范围以[兼容与维护政策](docs/compatibility.md)中的精确版本为准；已发布版本请查看对应 Release。

遇到问题时，可在 **设置 → 通用设置 → dsh-sidenote 诊断模式** 开启诊断，查看并手动导出接入状态。[报告问题或提出建议](https://github.com/g-yixuan/dsh-sidenote/issues/new/choose)。

## 一起完善 Sidenote

欢迎补充使用反馈、复现问题、改进文档和提交代码，中文与 English 都可以。开发环境、命令和检查步骤见[贡献指南](CONTRIBUTING.md)。

[仓库维护](docs/maintaining.md) · [发布指南](docs/releasing.md) · [MIT License](LICENSE)
