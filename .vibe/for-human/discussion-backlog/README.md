# Discussion Backlog

暂存尚未决策、需要后续继续讨论的议题。

每个议题一个 `NN-主题/` 目录，入口为 `README.md`；议题内部随讨论自由生长。议题收敛并落入正式设计、验证记录或 Initiative 后，整目录移入 `archive/` 归档。

- [01-Native侧栏可见性缺口的长期对策](./01-Native侧栏可见性缺口的长期对策/README.md)：PR#3 评审暴露的同一根因家族——tab 托管给宿主后插件丧失可见性；短期补丁已立项，长期走宿主 API 还是自建注册表层，待讨论。
- [02-摆脱dsh-better-sidebar硬依赖](./02-摆脱dsh-better-sidebar硬依赖/README.md)：better-sidebar 0.19 退位后中间层已成纯转发，依赖名存实亡——评估直连 DSH 原生 sidebarRight、optional peer 平滑过渡的方案与时机，待讨论。
