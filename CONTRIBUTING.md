# 参与贡献

[English](CONTRIBUTING_EN.md) · 中文

欢迎报告问题、提出需求、补充复现、改进文档、编写测试和提交代码。贡献不只限于功能开发；第一次参与可以从 [good first issue](https://github.com/g-yixuan/dsh-sidenote/labels/good%20first%20issue) 或 [help wanted](https://github.com/g-yixuan/dsh-sidenote/labels/help%20wanted) 开始。中文和 English 都可以。

## 先选择入口

- **Bug**：使用 [Bug 表单](https://github.com/g-yixuan/dsh-sidenote/issues/new?template=bug_report.yml)，提供版本、复现步骤、实际与预期行为。截图或录屏有助于说明侧栏与编辑器问题。
- **需求**：使用 [需求表单](https://github.com/g-yixuan/dsh-sidenote/issues/new?template=feature_request.yml)，先讲使用场景和要解决的问题。新功能、交互改动、兼容范围变化和较大重构，请先在 Issue 中对齐方向。
- **使用问题**：使用 [提问表单](https://github.com/g-yixuan/dsh-sidenote/issues/new?template=question.yml)。目前使用 Issues 统一交流。
- **小修复、错字、文档或测试补充**：可以直接提 PR，无需额外创建 Issue。
- **安全漏洞**：请按 [安全报告说明](SECURITY.md) 私密报告。

开始前搜索已有 Issue 和关联 PR。想接手已有任务，可以留言说明计划；已有人在做时，帮助复现、测试或 review 同样有价值。

本项目主要聚焦侧边聊天、划选注释、结论回流和 DSH 宿主兼容。优先使用宿主已有能力，保持依赖和实现简单。接受方向不等于承诺交付日期。

## 开发环境

CI 使用 Node.js 22；pnpm 版本以 `package.json` 的 `packageManager` 为准。fork 并 clone 仓库，从最新 `main` 创建主题分支：

```bash
git switch -c fix/your-change
pnpm install --frozen-lockfile
```

外部贡献者推送到自己的 fork；仓库维护者也使用主题分支。**所有修改经 PR 合入 `main`，包括文档、CI 和版本变更，不直接推送 `main`。**

代码修改的基本检查：

```bash
pnpm check:arch
pnpm typecheck
pnpm build
pnpm test
```

先 build 再 test：产物完整性测试需要本次生成的 `lib/`。纯文档修改检查内容、链接和渲染即可，在 PR 中说明；GitHub CI 仍会运行。

### 真实宿主验收

涉及页面交互、会话编排或宿主兼容的改动，需要相关 E2E 或手工验证。直连宿主示例：

```bash
pnpm exec playwright install chromium
BS_VERSION=none DSH_CMD="npx -y --package @deepseek-ai/dsh@0.1.7-rc.2 dsh" pnpm test:mount
```

脚本使用临时 DSH_HOME；版本组合以 [CI 矩阵](.github/workflows/ci.yml) 为准。CI 会运行 legacy 和直连组合，贡献者本地可先验证受影响的组合。

无模型凭证的 E2E 验证交互与挂载，不验证模型回答。涉及主线运行中开侧聊、取消、队列或进展快照时，请额外说明真实运行场景和验证结果；没有验证的范围也应明确写出。

## 代码与测试

- 沿用邻近代码风格，不把无关格式化、重构或依赖升级混进 PR。
- `src/index.ts` 是宿主入口；`src/client/host/` 收敛宿主差异；`sidechat/` 与 `annotate/` 不直接互相依赖，共享逻辑放在公共层。
- 使用现有工具链。新增依赖、配置项或兼容分支需要说明必要性。
- Bug 修复优先加入能复现原问题的回归测试；行为变化补相关测试和文档。纯文案修改不要求编写测试。
- `lib/`、测试产物、个人路径和本地 agent 记录不提交。截图、会话日志和链接请去除凭证及私人内容。

## 提交 PR

PR 指向 `main`，一条 PR 聚焦一个问题。标题使用 `fix:`、`feat:`、`docs:`、`test:`、`refactor:`、`ci:`、`chore:` 或 `release:` 前缀，正文和标题描述可使用中文或英文。

请在 PR 模板中说明问题、变更后的行为、关联 Issue（如有）、验证命令与结果。交互变化附截图或录屏；与兼容性相关时写明 DSH 和 better-sidebar 版本。测试不适用时解释原因。

可以先开 Draft PR 讨论。准备好后转为 Ready，并处理 CI 失败与 review 意见。首次 fork 的 CI 可能需要维护者批准运行；这不表示你的改动已被拒绝。

普通功能和修复 PR 不改包版本；版本变更由维护者通过独立发布 PR 处理。提交过程中可有多个 commit，不必为整理历史反复重写他人的提交。

允许 AI 辅助贡献。提交者需要理解并能解释改动，对复现和验证结果负责；请在 PR 中简短说明 AI 辅助范围。不提交自己未核对的生成内容或重复 PR。

## 协作与署名

遵守[社区行为规范](CODE_OF_CONDUCT.md)，围绕事实讨论，尊重贡献者与维护者的时间。维护者按可用时间处理反馈，不承诺固定响应或发布周期。

合并时保留贡献作者署名；多人参与时保留共同作者信息，GitHub 自动统计贡献者。持续帮助复现、答疑、review 和交付的人，也可以参与[仓库维护](docs/maintaining.md)。
