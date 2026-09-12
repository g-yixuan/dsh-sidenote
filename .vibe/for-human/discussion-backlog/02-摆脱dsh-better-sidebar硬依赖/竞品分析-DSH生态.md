# DSH 生态竞品分析（侧边聊天 × 划选注释）

> 2026-09-12 调研。范围为 DSH 生态内的直接与相邻竞品，不含 Cursor/Codex/Claude Code 等行业大盘（那些仅作背景参照）。下载量口径：npm API 为近月（08-12~09-10），awesome-dsh-plugin 为 30 天窗口，两者略有差异，各自标注。

## 一、时间线：这个赛道五周内挤进了 5 个玩家

| 日期 | 事件 |
|---|---|
| 08-07 | dsh-sidechain 创建（生态第一个侧聊插件，omdsh-dev） |
| 08-17 | CiteCiter 创建（划选 → 独立 Topic，kirkchinese） |
| 08-19 | dsh-sidenote 创建（本仓库） |
| 08-21 | **better-sidebar 内置 sidechat 落地（PR #286）**，08-22 转录重构（#314）——omdsh-dev 把自家 sidechain 的概念吸收成宿主插件的一等公民 tab |
| 08-28 | sidenote npm 首发 |
| 08-31 | sidechain 最后一次 push，此后停更 |
| 09-04 | dsh-harness-chat-control 创建（引用胶囊 + 侧边提问，Windows Desktop） |
| 09-07 | chat-control 最后 push；CiteCiter 发 0.6.0 |
| 09-12 | 现状：**存活者 3 家**（better-sidebar 内置、CiteCiter、sidenote），其余 2 家停更 |

sidechain 的死因已确认是**被自家吸收**：better-sidebar `sidechat-core.ts` 的 boundary prompt 首行刻意与 sidechain 保持一致（源码注释明写 "same first line as dsh-sidechain's boundary"），是同组织的主动兼容收敛，不是市场竞争淘汰。

## 二、竞品详情

### ① better-sidebar 内置 sidechat —— 唯一的"结构性对手"

读本地源码（`src/client/builtins/tabs.tsx` / `SideChatView.tsx` / `sidechat-core.ts`）确认：

- **有的**：Codex 式侧聊 tab（侧边对话 1/2/3…）、真 fork、流式转录、工具块渲染、线程重开/去重（dedupeKey by threadId）、preset·model 身份徽章。种子工程质量极高——父会话在途回合用合成 `step/end` + `turn/end{reason:'interrupted'}` 诚实冻结为"被打断"态，悬空工具调用回退到结构化文本快照。
- **没有的**（grep 实证）：**回流 reflow、划选注释、引用，一个都没有**。composer 也只有简单输入（无模型切换/图片/斜杠命令/@引用）。
- **地位**：310K/月下载、市场装机第一、默认开启、且是 sidenote 的硬依赖——sidenote 的每个用户同时是它的用户，侧聊入口就在隔壁 tab。
- **归属**：omdsh-dev 组织。该组织同时在侧聊赛道下了两注（sidechain + 内置 sidechat），且 better-sidebar 至今高频维护（09-11 仍有 push）。

**判断：功能上它缺 reflow 和注释两大纵深，但分发上不可战胜。它吸收 sidenote 的功能只是意愿问题（MIT 源码全开放）。**

### ② dsh-sidechain —— 已死，但遗产有价值

14★ / 6 fork，停更于 08-31，只适配到 DSH 0.1.1-rc.2，无 npm 包（源码安装 + allowBuilds）。机制是 subagent fork-in-process，**不含父会话在途回合**（issue #5 用户抱怨中），3 个 open issue 无人修。

**遗产：它验证了 `/btw` 一次性侧问（后台单轮问答、主会话零感知）的需求真实存在，然后死了。这个入口心智现在无人认领。**

### ③ dsh-harness-chat-control —— 功能镜像，执行落后

2★ / 0 fork，停更于 09-07。功能面与 sidenote 高度对撞：引用胶囊（≈ 注释 chip）、「在侧边聊天中提问」（连交互词都相同）、编辑重发、停止按钮。

但执行全面劣势：锁定 DSH 0.1.2-alpha.1（落后三个大版本）、把 better-sidebar 0.17.1 源码整个 vendor 进自己包（升级地狱）、仅限 Windows Desktop、PowerShell 安装长征、v0.2.64 的补丁号暴露高频救火。

**值得注意：它用"冻结依赖源码"回答了本议题（02）讨论的同一个依赖问题——反证痛点是全生态公认的，但它选了最差的一种解法。**

### ④ CiteCiter —— 被低估的同期双子星，本调研最大发现

kirkchinese/CiteCiter，npm `@kirkchinese/dsh-citeciter`。**与 sidenote 同期出生（晚两天，08-17），今天（09-12）仍在活跃维护**，0.6.0 已适配 DSH 0.1.2-rc.1 + Desktop 2.0.5。

| 维度 | CiteCiter | sidenote |
|---|---|---|
| 30 天下载（awesome 口径） | **1,997** | 467（4.3 倍差距） |
| 定位叙事 | "AI 输出**学习、检查与纠偏**"（教育/审阅场景） | "支线问题不打断主线"（工程场景） |
| 入口 | 划选已提交回答 → 右键"开始提问/讲解"；还能从工具结果、终端结果、diff 片段、Reader 创建 | 划选 → 注释编辑器；`/side`、顶栏按钮、`+` 菜单 |
| 会话模型 | Observer（私有日志 + 按需读源事件）与 Exact Fork（仅继承已结束轮次）双模式 | 真 fork 全量历史（含在途回合） |
| 输出面 | 自绘"并排学习栏"（宽屏独立列 28%–55%）+ **"小黑板"**（公式/表格/安全 SVG/隔离 HTML 动画/图片，`blackboard_apply` 原子提交） | 原生右栏 tab |
| 社区运营 | **QQ 群**（1108040435） | GitHub issue |

它的分发优势来源值得拆解：QQ 群的中国用户触达、Desktop 双端适配、以及"学习/讲解"这个差异化叙事比"侧聊"更锋利——"小黑板"是个独创输出面。

**它的结构性弱点（对 sidenote 的机会）**：
1. 无回流——README 明写 "Topic 不向主 Session 追加事件"，是设计边界不是疏忽；
2. 无累积注释工作流——一次一个 Topic，没有"多条注释 → 编辑 → 随消息发送 → 留痕"的链路；
3. Observer 模式不继承在途回合（"Exact Fork 需等待来源轮次结束"；"未提交的流式文字没有稳定引用坐标"），引用时机受限；
4. 并排学习栏不走原生右栏，README 自述"宿主没有公开的右侧 dock 尺寸接口，尺寸分配用集中维护的宿主布局适配器，升级宿主后需重新验收"——**它背的是另一份宿主适配债**（与本议题 02 同病：宿主 API 缺口迫使插件自建桥）；
5. 适配停在 0.1.2-rc.1，落后 sidenote 一个大版本线。

### ⑤ 相邻赛道（非直接竞品，但挤压生存空间）

- **dsh-reference-anything**（Chael-Chael，2,441/30d）：统一 @ 菜单引用工作区文件、DSH 会话、外部历史对话——与 sidenote 的 `@` 引用侧聊部分重合，分发量 5 倍于 sidenote。
- **rewind/编辑重发家族**：dsh-rewind（10,939/30d）、dsh-turn-rewind（7,230）、DSH-EasyRewrite（6,488）、dsh-recall-plugin（5,583）、dsh-retrace（2,889）、dsh-message-edit（3,126）——chat-control 的编辑重发能力在这个赛道有六七个专精玩家，**说明"编辑重发"不是 sidenote 值得追的差异化方向**（市场已饱和，头部 10K+/月）。

## 三、能力矩阵（DSH 生态内存活玩家）

| 能力 | sidenote | BS 内置 sidechat | CiteCiter | sidechain† | chat-control† |
|---|---|---|---|---|---|
| 状态 | **活跃** | **活跃（高频）** | **活跃** | 停更 | 停更 |
| 30 天下载 | 467 | ~310,000（宿主自带） | 1,997 | 无 npm | 无 npm |
| DSH 0.1.5 | ✅ | ✅ | ❌ 0.1.2-rc.1 | ❌ 0.1.1 | ❌ 0.1.2-α |
| 安装 | npm 一步（需先装 BS） | 随宿主 | npm 一步 | 源码+构建 | git+锁版+PS |
| 真 fork 含在途回合 | ✅ | ✅ 冻结为"被打断" | ❌ 需回合结束 | ❌ 丢在途 | ✅ |
| composer 对等（模型/图/斜杠/@） | ✅ | ❌ | ✅ 切模型+思考强度 | ❌ | ✅ 复用原生 |
| **回流 reflow** | ✅ **生态独有** | ❌ | ❌（设计边界） | ❌ | ❌ |
| **累积注释工作流** | ✅ **生态独有** | ❌ | ❌ | ❌ | ⚠️ 单条胶囊 |
| 划选入口 | ✅ | ❌ | ✅（+工具/终端/diff/Reader） | ❌ | ✅ |
| 一次性侧问 `/btw` | ❌ | ❌ | ⚠️ Topic 即问即答 | ✅ | ❌ |
| 编辑重发 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 独特输出面 | — | — | ✅ 小黑板 | — | — |
| Desktop 端 | ❌ | 随宿主 | ✅ | ❌ | ✅（仅此） |
| 社区运营 | GitHub | GitHub+市场 | **QQ 群** | — | — |

† 停更者列灰供参照。

## 四、结论：还有没有机会

**对停更者（sidechain、chat-control）：已经超过。** 两者锁死在旧版 DSH 上，宿主五周五個 minor 的迭代速度下，"当前唯一能用"本身就是护城河。

**对 CiteCiter：不是零和，是错位共存。** 它在教育/审阅叙事 + 小黑板输出面 + QQ 群触达上领先；sidenote 在工程叙事 + 回流 + 累积注释 + 0.1.5 适配上领先。它的三个结构性弱点（无回流、无累积注释、引用时机受限）恰好是 sidenote 的三个最强项。**但 4.3 倍的下载差距说明叙事和触达比功能清单更能带来用户**——这是运营问题不是工程问题。

**对 better-sidebar 内置 sidechat：赢不了消耗战，只能换战场。** 分发不可战胜，功能吸收只是意愿问题。唯一的结构性机会就是本议题（02）本身：拆掉依赖换来它没有的**独立分发**（一步直装）和**独立节奏**。此外 CiteCiter 的并排列路线反证：不走原生右栏的玩家都在背宿主适配债（它自述"升级宿主后需重新验收"），sidenote 走原生右栏 + 拆依赖是对的方向。

**悬顶之剑**：DSH 原生本体目前无任何 side conversation / annotation 概念（0.1.1-rc.2 全量类型面 grep 零匹配），但 0.1.5 已有原生右栏，行业大盘（Cursor v3.11 / Codex CLI v0.132）都已把侧聊做成 table stakes。原生侧聊落地之日，侧聊全品类归零，**注释工作流是唯一结构性纵深**——它是协议层（结构化 XML、持久化锚定、发送留痕）而非 UI 皮肤，原生吞并成本高得多。

## 五、可执行的机会窗口

1. **`/btw` 一次性侧问**：sidechain 验证需求后死去，入口心智无人认领。对 sidenote 约一天工作量（fork + 单轮 + 自动归档 + 答案以通知形式回来）。
2. **回流上 README 第一屏**：生态独有能力目前埋在功能列表中部，而竞品全部没有。这是最便宜的差异化放大器。
3. **叙事 sharpen**：CiteCiter 用"学习、检查与纠偏"拿到了 4 倍分发。sidenote 的"支线问题不打断主线"之外，可以考虑面向"审查 AI 输出"场景的第二叙事（划选注释天然贴合审阅工作流）。
4. **触达**：QQ/微信群 + awesome-dsh-plugin 的双语 README 已就位，缺的是持续曝光（发版节奏本身就是曝光——dshmarket 按 npm 周下载排序，每次发版带来一波下载脉冲，08-30 和 09-09 的两个峰值与此吻合）。
5. **不做编辑重发**：rewind 家族六七个玩家、头部 10K+/月，追进去是红海且偏离注释/侧聊主线。
