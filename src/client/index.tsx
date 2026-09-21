/**
 * Client half of dsh-sidenote: the side-chat tabs (Workitem 01) and the
 * selection annotations (Workitem 02).
 *
 * 双模（Workitem_05）：betterSidebar 是 optional peer——
 * - 宿主 ≥ 0.1.5（有 sidebarRightTabs）：侧聊直连原生右栏（无论 BS 在不在）；
 * - 宿主 ≤ 0.1.2 + BS < 0.19：legacy 腿（betterSidebar 布局）。
 * betterSidebar 不在 inject 清单（required 会让无-BS 环境拒绝启动插件）；
 * 运行时经 directNativeLeg(ctx) 分腿，消费点全部判空。
 */
import type { Context } from './host/contracts.ts'
import { probeHost } from './host/probes.ts'
import { attachLocale, type LocaleServiceLike } from './locales.ts'
import { createReflowStore } from './reflow.ts'
import { registerSideChat } from './sidechat/index.tsx'
import { registerAnnotations } from './annotate/index.tsx'
import { clearNativeRuntime, setRootContext } from './sidechat/native.ts'
import { sweepOrphanedSideChatMeta } from './sidechat/metaStore.ts'

export const inject = ['sessions', 'workspaces', 'slots', 'connection', 'locale']

export function apply(ctx: Context): void {
  // 侧栏 Tab 的原生面（better-sidebar >= 0.19）与宿主调用都要用插件根 ctx：
  // 面板拿到的是 slot 注入的收缩 ctx（inject 里没有 workspaces），见 native.ts。
  // fiber 撤销即清场（registry/openings/birthOrder 全模块级，重激活不得带病存活）。
  ctx.effect(() => {
    setRootContext(ctx)
    return () => { clearNativeRuntime() }
  }, 'dsh-sidenote: native bridge')
  // 跟随 DSH 通用设置里的语言（locale.preference，Host-backed，实时切换）。
  attachLocale(ctx.locale as LocaleServiceLike | undefined)
  // T2 off-face 全景探测：宿主升级后哪些能力降级了，开发者工具里一眼可见。
  probeHost(ctx)
  // 孤键清扫（对抗性审查 B2）：原生布局 memory-only，刷新后 tab 消失而
  // metaStore 键残留——不清场则编排层把残留当存活 tab，入口折叠成聚焦一个
  // 不存在的 tab（该会话侧聊死锁）。runId 不匹配的残留记录在此清掉。
  sweepOrphanedSideChatMeta()
  // 回流 store 两个模块共享：sidechat 生产（回流按钮），annotate 消费
  // （chip + 发送拦截器序列化）。
  const reflow = createReflowStore()
  registerSideChat(ctx, reflow)
  registerAnnotations(ctx, reflow)
}
