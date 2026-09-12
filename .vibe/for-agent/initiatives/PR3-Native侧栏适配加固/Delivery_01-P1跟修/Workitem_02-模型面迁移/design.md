# Workitem_02 design

## 源码事实

- 0.1.5-rc.2 `dsh-api-session-controller`：`SessionProjectionMap.modelSelection: ModelSelectionProjection = { lastUsed: ModelSelection|null, next: ModelSelection|null }`（types.d.ts:89-95）；`selectModel(request: SessionSelectModelRequest extends ModelSelection { sessionId })` 返回 `RemoteResult<SessionSelectModelValue>`。
- `remote.session.selectModel` 在 0.1.2-rc.1 的类型里已存在；运行时是否 wire 待沙箱实测。
- cordis inject 门禁实证：未 inject 的服务属性访问抛错，`ctx.get(name)` 绕过（compat agent 实测）。`ctx.remote?.session` 在 sidenote 根 ctx 上恒抛（inject 无 'remote'）。
- 0.1.5 已删 `ctx.connection.api.sessions.*`（0.1.5 依赖树 grep 为空）；0.1.2 及更早存在。

## 方案

- 统一读取面 `modelSelectionOf(ctx, sessionId)`：投影优先（含 null 守卫 + lastUsed 回落），labels 消费。
- `listModels` → `remote.session.modelCatalog()`；`switchModel` → `remote.session.selectModel`；均回退旧 `connection.api` 面（双版本链，feature-check 优先新面）。
- fork 同步同理：新面失败/缺席回退旧面。
- probes.ts 补登三条。

## 待裁决

- 0.1.2 运行时 remote.session 是否可用（沙箱加挂 0.1.2 profile 或静态考古 dsh-client-ui-model-selection 0.1.2 时代的 inject 声明）。
