# 摆脱 dsh-better-sidebar 硬依赖

## 起因

2026-09-12 复盘下载量与用户数据时重新审视了这个依赖：安装链路要求用户先装一个 310KB、带终端/文件树/git 面的大插件才能用侧聊，issue #1（README 安装命令踩坑）证明用户确实是逐条照 README 走的——每多一步依赖就流失一批人。0.19 适配的代价（PR#3 全套补丁 + Initiative `PR3-Native侧栏适配加固`）也是在这层依赖上买单。

深挖两个仓库的代码后，核心判断是：**这个依赖在架构上已经名存实亡**。

## 现状盘点（2026-09-12 数据）

- **用户面**：npm 首发 2026-08-28，近周下载 248 / 近月 612；5 star、2 fork（sanosa02 提过 PR#3，linmu115 在自己 fork 上持续适配 DSH alpha/rc 线，48 commits ahead）；两个外部 issue 均已修复关闭。已有一批真实用户，破坏性变更需要考虑存量。
- **生态位**：上游 dsh-better-sidebar 月下载 31 万，本包 612/月约为其 0.2%，渗透率还很低。
- **版本地面**：`@deepseek-ai/dsh` 的 npm dist-tags——`latest` 已是 **0.1.5-rc.1**、`next` 是 0.1.5-rc.2。新装用户默认拿到原生右侧栏；旧版存量小且在自然流失。

## 架构分析：依赖已名存实亡

better-sidebar 自己完成了"退位"：**0.19+ 起右栏归 DSH 本体所有**（`dsh-client-ui-sidebar`，`ctx.sidebarRight` + `ctx.sidebarRightTabs`），better-sidebar 只把自己的 TabDescriptor 转译成原生注册、把 openTab/closeTab/activateTab 转发给原生面。

于是 sidenote 现在的调用链是：

```
sidenote → betterSidebar 服务 → surface 桥 → DSH 原生 sidebarRight
```

中间那层对 sidenote 而言已是**纯转发**——0.3.x 那轮适配修的正是这层转发的缝隙。

## 依赖面盘点

sidenote 实际消费的 `ctx.betterSidebar` 面，对照原生等价物：

| sidenote 现调用 | 原生等价 | 状态 |
|---|---|---|
| `registerTab(descriptor)` | `sidebarRightTabs.register({id, kind, priority, title, guide})` + `sidebar.right.pane.tab` keyed 槽 | ✅ 通用公开接口 |
| `openTab(seed, scope)` | `ctx.sidebarRight.openTab(kind, {params})` / `openTabIn(sessionId, …)` | ✅ |
| `closeTab(tabId, scope)` | `ctx.sidebarRight.close(tabId)` / `closeIn(...)` | ✅ |
| `activateTab(tabId)` | `ctx.sidebarRight.focus(tabId)` | ✅（`focusNativeTab` 已在直连） |
| `updateTab(tabId, {meta})` | ❌ 无等价（原生布局 memory-only） | ⚠️ 唯一要自建 |
| `getSnapshot()` 读 splits 树 | 不再需要（live registry 已替代） | ✅ 已就绪 |

三大核心能力链路**本就不经过** better-sidebar：fork 走 `ctx.sessions.fork()`（原生 RPC）、转录渲染走 `ConversationSnapshot`（原生 sessions 契约）、划选注释完全自研。`native.ts` 已写了半套原生桥（liveSideChats registry、openings 窗口期管理、focus 探测）——**去依赖的活已经干了一半**。

## 迁移方案草案

估计 300~500 行净改动：

1. **自注册 tab 类型**：`ctx.inject(['sidebarRightTabs'])` 驱动注册 + `sidebar.right.pane.tab` 槽挂面板体，key 用自己的前缀 `dsh-sidenote:side-chat`（照抄 better-sidebar `native/index.ts` 的模式）；
2. **meta 持久化自建**：`updateTab` 换成自有 store（`recentClosed` 已有同款 localStorage 模式可循）；
3. **实例编号**（"侧边""侧边 2"）自建计数器；
4. **`.paneBody` 布局适配**：包一层 `height:100%` 列 flex 宿主（better-sidebar 的 `.nativeTabHost` 即教科书，几行 CSS）；
5. **删掉 legacy 双模**：`nativeSidebarHost()` 判断、splits 树遍历——净删代码。

上游踩过的坑（作业可直接抄）：

- 注册必须**等服务**（`ctx.inject(['sidebarRightTabs'])`）不能等槽声明——真机上槽先声明、服务 3 秒后才出现，等错了永久静默不注册；
- `openTab` 只写**在屏会话**，跨会话需结构化探测 `openTabIn`/`closeIn`（不在 `ISidebarRight` 接口里）；
- openTab → 面板挂载之间有不可见窗口期（sidenote 的 openings 机制已处理）。

## 代价与时机

- **唯一实质代价**：只能支持 DSH ≥ 0.1.5-rc.1。`latest` 已指到 0.1.5-rc.1，这个窗口正在快速关闭。
- **收益**：安装一步到位；版本节奏与上游 better-sidebar 大版本迁移解耦；与 better-sidebar **天然共存**（各自在原生栏注册类型，不是二选一），已装用户无感。
- **建议路径**：不硬切——把 `dsh-better-sidebar` 从硬 peer 降为 optional peer（`peerDependenciesMeta`），运行时探测：有 `sidebarRightTabs`（DSH ≥ 0.1.5）直连原生面，没有但 `betterSidebar` 在则走旧路。老用户不断，新用户一步直装，普及率够了再删 legacy 腿。

## 子文档

- [竞品分析-DSH生态](./竞品分析-DSH生态.md)（2026-09-12）：生态内 5 个玩家的全景盘点——存活 3 家（BS 内置 sidechat、CiteCiter、本插件）、停更 2 家。核心发现：CiteCiter（同期双子星，月下载 4.3 倍）无回流/无累积注释/引用时机受限，弱点恰好是本插件最强项；CiteCiter 的并排列路线自背宿主适配债，反证"原生右栏 + 拆依赖"方向正确；回流是生态独有但 README 未放到第一屏；`/btw` 一次性侧问需求已被 sidechain 验证后无人认领。

## 待讨论

1. **过渡形态**：optional peer 双模过渡 vs 直接硬切 0.1.5-only？双模意味着维护两条腿一段时间；硬切简单但伤害未升级用户。
2. **与议题 01 的关系**：[01-Native侧栏可见性缺口的长期对策](../01-Native侧栏可见性缺口的长期对策/README.md) 的"宿主 API 线"（向 better-sidebar 提 activate/onClose/meta 面）在本方案下大部分失去意义——01 是否收敛归并进本议题？01 里的**多实例 `held` 语义**问题在纯原生线下依然存在，仍需解。
3. **meta 持久化形态**：localStorage（`recentClosed` 同款）够不够？还是该走插件自有 host 路由（参照 better-sidebar 的 `sidechat.events` 自有路由模式）？
4. **时机**：现在动，还是等 0.1.5 出正式版（去掉 -rc 后缀）再动？
5. **版本主张**：迁移后 peerDependencies 里要不要显式声明 `@deepseek-ai/dsh` 的版本下限？目前插件没有直接声明 dsh 版本约束的先例（靠 better-sidebar 传递约束）。

## 当前状态

分析完成、方案有草案，未决策。等定过渡形态与时机后，若确认执行则转 `manage-vibe-initiatives` 立项。
