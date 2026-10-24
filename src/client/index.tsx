/** Client entry: shared native conversations, annotations and side-chat lifecycle. */
import type { Context } from './host/contracts.ts'
import { registerCompatibilityStatus } from './diagnostics/index.tsx'
import { attachLocale, type LocaleServiceLike } from './locales.ts'
import { createReflowStore } from './reflow.ts'
import { createAnnotationStore } from './annotations/model.ts'
import { registerSideChat } from './sidechat/index.tsx'
import { registerAnnotations } from './annotate/index.tsx'
import { clearNativeRuntime, setRootContext } from './sidechat/native.ts'
import { sweepOrphanedSideChatMeta } from './sidechat/metaStore.ts'
import { registerSideSessionVisibility } from './sidechat/visibility.tsx'

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
  registerCompatibilityStatus(ctx)
  registerSideSessionVisibility(ctx)
  // 撤掉旧页面 meta 的活身份，避免把孤键当仍存活的 tab。宿主真的恢复
  // tab 时，由其 navigation revision 与挂载记录认领原 child。
  sweepOrphanedSideChatMeta()
  // 回流 store 两个模块共享：sidechat 生产（回流按钮），annotate 消费
  // （chip + 发送拦截器序列化）。
  const reflow = createReflowStore()
  const annotations = createAnnotationStore()
  registerSideChat(ctx, reflow, annotations)
  registerAnnotations(ctx, reflow, annotations)
}
