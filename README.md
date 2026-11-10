<p align="center">
  <picture>
    <source media="(max-width: 640px)" srcset="docs/assets/hero-compact.svg">
    <img src="docs/assets/hero.svg" alt="dsh-sidenote。侧边聊天、划选批注与结论回流，让思路展开。" width="100%">
  </picture>
</p>

<p align="center">
  为 <b>DeepSeek Harness</b> 加上侧边聊天、划选批注与结论回流。<br>
  沿用原生聊天体验，让支线讨论和逐段反馈更顺手。
</p>

<p align="center">
  <a href="#按需使用">功能</a> ·
  <a href="#侧边也是你熟悉的聊天体验">原生体验</a> ·
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

![主对话与原生侧聊同屏，展示划选批注、侧聊回答、待发送的问答与上下文预览](docs/assets/workflow.jpg)

<p align="center"><sub>dsh-sidenote 0.7.2 · DSH 0.2.1-rc.2 · DeepSeek V4.1 Flash · 真实交互录制</sub></p>

## 按需使用

### 侧边聊天，随时展开一个想法

想追问一种实现、核对一个细节，或临时发散一下，点击会话顶栏的 **「侧边」**，或从 **`/side`** 菜单选择 **「新建侧边聊天」**，直接写下问题。侧聊继承主线当前有效上下文，可以继续多轮讨论和使用工具，主线与支线各自推进。

右栏可以保留多个独立侧聊。最近关闭的侧聊可从 `/side` 重开，值得长期保留的讨论可保存为正式会话。

### 划选批注，把意见留在原文上

评审方案或阅读回答时，选中一段文字，点击 **「添加到对话」**，写下问题或修改意见。原文与批注一起保留，多处意见可以累积，预览、编辑后随下一条消息发送。

主对话和侧聊中都能批注。想围绕主线中的某段话展开讨论，也可以选择「在侧边聊天中提问」，把选区带入侧聊。

### 结论回流，把有用的问答带回主线

侧聊中有了值得采用的答案，点击回答操作栏右侧的 **「带回主对话」图标**，问题与答案成对出现在主输入框上方。预览、选择后随下一条消息发送，让主线接着这份结论继续。

可以挑选一条回答，也可以使用「整段回流」带回侧聊新增且已完成的问答。正文草稿与待回流内容分别保留。

## 安装

在已安装 DSH 的环境中执行下面的命令。

```bash
dsh plugin --profile web add dsh-sidenote
```

打开 DSH Web，点击 **「侧边」** 或从 **`/side`** 菜单选择 **「新建侧边聊天」**。需要批注时，直接划选回复并选择「添加到对话」。

主线维护 DSH **0.2.2 系列（rc.1 起）**，复用宿主原生聊天界面。已验证 0.2.2-rc.1，同系列后续 RC 和正式版允许安装，验收记录按精确版本更新。DSH 0.2.2 需要 Node.js 24.9 或更新版本。此范围从插件 0.8.3 起生效，0.8.2 支持 0.2.1 系列。DSH 0.2.1 固定 `dsh-sidenote@0.8.2`，0.2.0-rc.2 固定 `dsh-sidenote@0.7.6`，更早宿主固定各自最后兼容包，详见[兼容政策](docs/compatibility.md)。

## 侧边也是你熟悉的聊天体验

侧聊**直接复用 DSH 原生的输入框、消息流和工具卡**。模型与推理强度、权限切换、图片、`@` 引用和命令都沿用熟悉的操作，审批与提问也能在侧聊面板内完成。

在这套原生界面上，Sidenote 加上了继承上下文的折叠分区、批注预览和问答回流。日常操作的细节也一起照顾。

| 使用时的细节 | Sidenote 如何处理 |
|---|---|
| 主线与侧聊来回输入 | `Alt+S` 切换主输入框与当前侧聊输入框的焦点。 |
| 发送前检查原文和意见 | 悬停预览，点击固定展开，批注可原位编辑、逐条移除。 |
| 查看已经发出的上下文 | 批注和回流问答收在对应消息的标签中，随时打开查看。 |
| 消息发送失败 | 保留正文、批注和待回流内容，方便重试。 |
| 刷新或重启后继续 | 侧聊历史与已保存批注保留，最近关闭的侧聊可从 `/side` 重开。 |
| 保持主会话列表清楚 | 侧聊默认隐藏，保存为正式会话后才进入列表和搜索。 |

具体操作、恢复行为和划选范围见[使用指南](docs/usage.md)。

## 上下文与模型费用

侧聊沿用主线当前有效上下文，首次发送时确定带入的进展，随后独立继续。宿主已有的压缩摘要和保留尾部继续生效。**打开侧聊本身不发起模型请求**，发送问题后才开始推理。

**相同的请求前缀有机会复用模型服务的上下文缓存，降低输入费用。** 例如，DeepSeek API 默认启用上下文缓存，命中的输入部分按缓存价格计费。实际命中取决于模型与提供方、请求前缀是否一致，以及缓存是否已建立并仍然有效。后续模型调用的费用以所选服务商的计费规则为准。[DeepSeek 缓存说明](https://api-docs.deepseek.com/guides/kv_cache/) · [输入计费](https://api-docs.deepseek.com/quick_start/pricing/)

## 看看它如何工作

下面以笔记搜索方案评审为例，展示批注、侧聊与回流在一次任务中的配合。

![真实 Flash 演示：划选批注、悬浮查看与编辑、侧聊追问、图标回流，以及发送后的气泡内引用](docs/assets/demo.gif)

[观看清晰版 MP4](docs/assets/demo.mp4) · [查看静态截图](docs/assets/workflow.jpg)

<sub>2026-10-25 录制于 dsh-sidenote 0.7.2 / DSH 0.2.1-rc.2。以笔记搜索设计为例，真实调用官方 DeepSeek V4.1 Flash 生成回答；约 43 秒的录屏展示实际操作与完整回复过程。<a href="docs/assets/README.md">素材说明</a></sub>

## 兼容与帮助

维护窗口覆盖 **当前 RC／正式版系列，可额外准入一个 alpha 系列**，侧聊共用原生 Conversation。新增 alpha 系列经完整验收准入，当前 RC 系列继续维护。日常 PR 检查每个系列的最低版和最新已验证版，每日探测 latest／next／alpha 通道及窗口内新增宿主，每周回归全部窗口内版本。当前系列滚动后，退出的旧系列固定最后兼容插件。详见[兼容与维护政策](docs/compatibility.md)；公开安装以对应 Release 为准。

遇到问题或有改进建议，欢迎[反馈](https://github.com/g-yixuan/dsh-sidenote/issues/new/choose)，附上 DSH 与插件版本、复现步骤或截图。

## 一起完善 Sidenote

欢迎补充使用反馈、复现问题、改进文档和提交代码，中文与 English 都可以。开发环境、命令和检查步骤见[贡献指南](CONTRIBUTING.md)。

[仓库维护](docs/maintaining.md) · [发布指南](docs/releasing.md) · [MIT License](LICENSE)
