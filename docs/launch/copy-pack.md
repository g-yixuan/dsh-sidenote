# 发布文案包（每平台一版，禁止同文案群发）

> 名字未定稿前，文中一律用 `dsh-sidechat`；若改名，全局替换即可。
> 所有版本都遵循：朴素陈述、不拉票、不求 star、接受批评。

---

## 1. Show HN（英文，GitHub 链接直投；北京时间 21:30-22:00 发）

**标题**：`Show HN: dsh-sidechat – Codex-style side chat and selection annotations for DeepSeek Harness`

**评论区置顶（作者自述）**：

> I built this because I kept losing my main thread when a side question came up mid-conversation with an AI coding assistant.
>
> dsh-sidechat is a plugin for DeepSeek Harness (built on dsh-better-sidebar's tab service) that does two things and ties them together:
>
> 1. **Side chat**: fork the current session into a persistent side panel — full history snapshot, no compression. It stays out of your session list, survives reloads, and you can run several at once.
> 2. **Selection annotations**: select text in an assistant reply, attach a note, and every annotation rides along with your next message as quoted context. Or send quote+note straight into a side chat.
>
> The part I haven't seen elsewhere: annotations are the on-ramp to the side chat — annotate, then ask about it without derailing the main conversation.
>
> Tech notes: it's a thin client plugin (no DSH changes) — `ctx.sessions.fork` for the child session, `archiveSession` to keep the list clean, layout-persisted tab metadata for restore, and a document-level selection listener with a `Range.getClientRects()` badge overlay. The whole thing is MIT and I verified it with headless Playwright lanes against a real DSH boot (including a fabricated session log so the fork path runs without model credentials).
>
> Happy to answer questions / take criticism.

---

## 2. V2EX「分享创造」（中文）

**标题**：`[开源] 给 DSH 写了个插件：Codex 风侧边聊天 + 划选注释，不打断主对话`

**正文**：

> 用 AI 编码助手时有个老毛病：主对话正推到关键处，突然想问个支线问题——问吧，打断主线；不问吧，憋着。
>
> 所以我写了 dsh-sidechat（DSH 插件，基于 dsh-better-sidebar 的 Tab 服务）：
>
> - **侧边聊天**：从当前会话 fork 出独立的侧边会话（全量历史快照，不是压缩摘要），在右侧栏开个「侧边」Tab 随便聊。可以多开，不进左侧会话列表，刷新/重启都还在，手动关掉才消失。
> - **划选注释**：在 assistant 的回复里划一段 → 写个注解 → 输入框出现「N 条注释」chip，随下一条消息一起发给模型。也可以划完直接「在侧边聊天中提问」。
>
> 演示：[GIF/视频]
> 安装：`dsh plugin --profile web add dsh-sidechat`
> 仓库：[GitHub 链接]（MIT）
>
> 第一次在这个生态发插件，欢迎拍砖。有想要的功能也可以直接开 issue。

---

## 3. LinuxDo（中文，搞七捻三/资源分享）

**标题**：`给 DSH 做了个侧边聊天 + 划选注释插件（开源）`

**正文**：

> 先上效果图：[截图/视频]
>
> 痛点：主对话推到一半想问支线问题，怕打断上下文。
>
> dsh-sidechat 是 DSH（DeepSeek Harness）的插件，消费 dsh-better-sidebar 的侧边栏服务：
>
> 1. 侧边聊天 = 真 fork（带全部历史）的独立会话挂在右侧栏，多开、归档不进会话列表、刷新不掉；
> 2. 划选注释 = 选中 assistant 的话 → 编号角标 + 注解 → 「N 条注释」chip 随消息发出；
> 3. 两个是打通的：注释一键进侧边聊天提问。
>
> 跟同类比：sidechain 也是真 fork 但没注释，dsh-annotation 只做注释没侧聊，sidebar-qa 是摘要压缩路线（有损）。我们这条是「注释 ⇄ 侧聊」闭环。
>
> 安装：`dsh plugin --profile web add dsh-sidechat`（需要先装 dsh-better-sidebar）
> 仓库：[GitHub 链接]
>
> 求试用求意见 🙏

---

## 4. 即刻（中文短动态）

> 给 DSH 写了个插件：主对话里划一句话就能挂个注解，攒几条一起发给 AI；支线问题可以 fork 出一个侧边小窗单独聊，不打断主线，刷新也不丢。
>
> 起名废物，先叫 dsh-sidechat。开源 MIT，一行命令装：[链接]
>
> [效果图/视频]

---

## 5. X/Twitter（英文）

> Built a thing for DeepSeek Harness: side chat (fork the session into a persistent side panel) + selection annotations (quote + note → rides your next message). Annotate → ask in the side chat without derailing the main thread.
>
> MIT, one-line install. [link]
>
> [demo video]
>
> #DeepSeek #AIcoding #OpenSource

---

## FAQ（评论区高频问题预案）

- **Q: 和 dsh-sidebar-qa / dsh-sidechain / dsh-annotation 有什么区别？**
  A: sidechain 同是真 fork 但无注释、无归档隐藏；sidebar-qa 是摘要压缩（轻但有损）；dsh-annotation 只做注释。我们是注释⇄侧聊闭环 + 归档隐藏 + 多实例。
- **Q: 侧边会话占资源吗？** A: 每个侧边聊天是真实会话，开着不跑模型就不花 token；关闭 Tab 即从界面消失（jsonl 留盘不可见，后续会出真删除）。
- **Q: 注释刷新就没了？** A: 当前是页面级生命周期（设计如此，快记快用）；跨轮持久化在路线图上。
- **Q: 装不上/没反应？** A: 确认先装了 dsh-better-sidebar；插件挂在它的侧边栏 `+` 菜单里。
- **Q: 模型怎么选？** A: fork 时跟随主会话当前模型；侧边独立切换在路线图上。
