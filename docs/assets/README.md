# README media / 首页素材

The screenshots and recording used by the README were captured on **2026-10-18** with **dsh-sidenote 0.6.0** (source: `7ed85e4`) and **DSH 0.2.0-rc.2**, using the native right sidebar without better-sidebar. The host's active bundle inventory and the mounted plugin's build hash were checked before capture.

首页截图与录屏于 **2026-10-18** 重新采集，使用 **dsh-sidenote 0.6.0**（源码 `7ed85e4`）与 **DSH 0.2.0-rc.2** 原生右侧栏，不安装 better-sidebar。采集前核对了宿主实际激活的组件版本与插件构建摘要。

- `workflow.jpg`: the main and side conversations with a returned answer / 主、侧对话与回流结论。
- `selection.jpg`: a selected passage and its note editor / 划选与注释编辑器。
- `sidechat.jpg`: a completed side-chat response / 侧聊问答。
- `demo.gif`, `demo.mp4`: the same continuous selection → annotation → side reply → reflow sequence / 同一段连续操作的 GIF 与 MP4。
- `hero.svg`, `hero-en.svg` and their `-compact.svg` variants: original vector covers; regenerate with `python3 scripts/build-brand-assets.py` / 原创矢量封面，可用该命令重新生成。

The host uses its **light theme** and a 16 px conversation font. Screenshots show the real interface; they are not UI mockups. The recording preserves browser frame timing. A browser translation extension's floating control was temporarily hidden during capture and restored afterwards. No DSH controls were altered.

宿主使用**浅色主题**与 16 px 会话字号。截图来自真实界面，录屏保留浏览器帧的时间间隔。录制期间临时隐藏了浏览器翻译扩展的浮动控件，随后恢复；没有修改 DSH 控件。

Conversation content is a synthetic note-search design example. A local demo adapter supplies fixed answers through the host's LLM interface; the fork, annotation, submission, and reflow paths are real. This illustrates the workflow, not model answer quality or latency. No private sessions or external model credentials are used.

对话内容是合成的笔记搜索设计示例。本地演示模型通过宿主 LLM 接口提供固定回答；fork、注释、发送与回流均执行真实流程。素材用于说明操作，不代表模型回答质量或响应速度，也不使用私人会话或外部模型凭证。

For future captures, use a fresh isolated DSH home and a verified host version, confirm the mounted bundle, select the light theme, and repeat the complete workflow. The older `capture-demo.mjs` and `capture-video.mjs` scripts target historical BS layouts and do not reproduce these native-sidebar assets unchanged.

以后重录时，使用全新隔离的 DSH home 和已验证宿主版本，核对实际挂载构建，选择浅色主题，并走完完整流程。旧 `capture-demo.mjs`、`capture-video.mjs` 面向历史 BS 布局，不能原样用于复现这组原生侧栏素材。
