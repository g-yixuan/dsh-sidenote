# README and storefront media / 首页与商店素材

Captured on **2026-10-25** with the published **dsh-sidenote 0.7.2** package (source: `0d55fcd`) and **DSH 0.2.1-rc.2**, using native Conversation and the native right sidebar. The mounted plugin's version and bundle digest, plus the host's active conversation, composer, and sidebar packages, were checked before capture.

素材于 **2026-10-25** 重新录制，使用已发布的 **dsh-sidenote 0.7.2**（源码 `0d55fcd`）与 **DSH 0.2.1-rc.2** 原生对话和右侧栏。录制前核对了实际挂载的插件版本与构建摘要，以及宿主正在运行的对话、输入框和侧栏组件版本。

## Real model responses / 真实模型回答

The example task is designing a note app's search experience. All assistant replies were generated through the official **DeepSeek V4.1 Flash** API at `api.deepseek.com`, using model ID `deepseek-flash` with thinking off. This ID's mapping is documented in the [official model updates](https://api-docs.deepseek.com/updates/). Request metadata confirmed successful, completed responses. No fixed-answer adapter or prewritten assistant messages were used.

演示任务是设计笔记应用的搜索体验。全部助手回复都实际调用 `api.deepseek.com` 的 **DeepSeek V4.1 Flash** 生成，模型 ID 为 `deepseek-flash`，关闭思考模式；该 ID 的对应关系见[官方更新说明](https://api-docs.deepseek.com/updates/)。请求元数据确认调用成功并完成，没有使用固定回答的适配器或预先写入的助手消息。

The recording starts with the real main-chat answer already visible. It then shows selection and annotation, a real side-chat response, hover previews, editing a pending note, the clear button's reveal, the reply-toolbar handback action, sending the main draft with both kinds of context, and inspecting the sent message. The main model's final answer incorporates the returned empty-state copy and the edited annotation.

录屏从已经生成的主线回答开始，随后展示划选与批注、真实侧聊回答、悬浮预览、原位编辑、清除按钮显现、回复操作栏回流、携带两类上下文发送，以及发送后的气泡详情。主线最后的真实回答同时采纳了带回的空状态文案与修改后的批注。

## Assets / 文件

- `workflow.jpg`: both conversations and a main draft with pending annotation and handback chips / 主侧对话与同时携带批注、回流的待发送草稿。
- `context-preview.jpg`: a compact preview with the selected passage, editable note, and horizontal context chips / 紧凑悬浮层中的原文、可编辑注解与横向标签。
- `selection.jpg`: selected text and the two annotation destinations, taken from the recording / 从录屏提取的划选画面与两种批注去向。
- `sidechat.jpg`: a real side-chat answer and the hovered reply-toolbar handback icon / 真实侧聊回答与悬停中的回流图标。
- `demo.gif`, `demo.mp4`: the same approximately **43-second** continuous workflow / 同一段约 **43 秒**的连续操作。
- `hero.svg`, `hero-en.svg` and their `-compact.svg` variants: vector brand covers; regenerate with `python3 scripts/build-brand-assets.py` / 品牌矢量封面，可用该命令重新生成。

## Capture and distribution / 录制与展示

The real interface uses the host's **light theme**, **18 px** conversation font, and a **1440 × 900** viewport. Stills are captured at 2× pixel density and exported at 2160 × 1350; the selection still is a native 1440 × 900 recording frame. MP4 is 1440 × 900 at 30 fps; GIF is 1120 × 700 at 12 fps. Encoding preserves the browser's frame timing without speeding up responses. A small pointer overlay follows actual mouse events; product controls and model replies are not redrawn or substituted.

真实界面使用宿主的**浅色主题**、**18 px** 会话字号和 **1440 × 900** 视口。静态截图按 2 倍像素密度采集后导出为 2160 × 1350；划选截图直接取自 1440 × 900 的录屏帧。MP4 为 1440 × 900 / 30 fps，GIF 为 1120 × 700 / 12 fps，均按浏览器帧时间编码，没有加速模型响应。仅添加跟随真实鼠标事件的小光标辅助层，没有重绘产品控件或替换模型回答。

[`screenshots.json`](../../screenshots.json) declares the storefront gallery. The [catalog's screenshot convention](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#screenshots--截图optional-recommended--可选推荐) resolves those paths from this repository, and the next catalog build refreshes the gallery. Existing screenshot paths remain available for cached catalogs.

[`screenshots.json`](../../screenshots.json) 声明商店展示顺序。[商店截图约定](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#screenshots--截图optional-recommended--可选推荐) 会从本仓库读取这些路径，下一次索引构建时更新图集；原有图片路径继续提供新版内容，供已缓存的索引读取。

For future captures, use a fresh isolated DSH home, install the published plugin with the official CLI, verify the active bundles, and run the complete workflow against the official model API. Keep credentials, launch tokens, private conversations, raw frames, and recording logs out of public assets. The older `capture-demo.mjs` and `capture-video.mjs` scripts target historical layouts and synthetic sessions; they do not reproduce this recording unchanged.

后续重录应使用全新隔离的 DSH home，通过官方 CLI 安装已发布插件，核对实际加载的构建，并调用官方模型走完完整流程。凭证、启动 token、私人会话、原始帧和录制日志不进入公开素材。旧 `capture-demo.mjs`、`capture-video.mjs` 面向历史布局与合成会话，不能原样用于复现本次录制。
