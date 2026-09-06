/**
 * 划选注释（Delivery_02 重构后）：selection listener + numbered badges +
 * annotation editor + the composer「N 条注释」chip + 发送拦截器 + 气泡留痕
 * 手术。Wiring only: one annotation store（localStorage 持久化）, one
 * selection controller, one overlay React root (appended to document.body
 * and marked `data-dsh-sidenote` so the listener excludes our own DOM), and
 * one `conversation.input.dock` slot entry. 全部 additive, and every seam
 * degrades to a logged no-op instead of crashing the host page.
 *
 * 整个模块包在一个 ctx.effect 里：HMR/插件禁用时 fiber 撤销即全部清理
 * （store 退订、document 监听器移除、overlay unmount、host div 移除）——
 * 否则重挂后双重挂载（两层工具条、双份监听、新旧 store 分裂）。slot 注册
 * 的 disposer 由 cordis 服务代理路由进调用方 fiber，无需手动回收。
 */
import { createRoot } from 'react-dom/client'
import type { Context } from '../../context-types.ts'
import { createAnnotationStore } from './model.ts'
import { createSelectionController } from './selection.ts'
import { AnnotateOverlay } from './overlay.tsx'
import { createAnnotationChip, createReflowChip } from './chip.tsx'
import { installSendInterceptor } from './send.ts'
import { installBubbleSurgery } from './bubble.ts'
import type { ReflowStore } from '../reflow.ts'

export function registerAnnotations(ctx: Context, reflow: ReflowStore): void {
  ctx.effect(() => {
    try {
      const store = createAnnotationStore()
      const controller = createSelectionController(() => ctx.sessions.list.getSnapshot().current ?? '')

      // The overlay root: toolbar + badges + highlight + editor + sent viewer.
      const host = document.createElement('div')
      host.dataset.dshSidenote = ''
      document.body.appendChild(host)
      const root = createRoot(host)
      root.render(<AnnotateOverlay ctx={ctx} store={store} controller={controller} />)

      // 发送携带：拦截器在提交瞬间把协议块（注释 + 回流）拼入正文（草稿零污染）。
      const offInterceptor = installSendInterceptor(ctx, store, reflow)
      // 发送后留痕：用户气泡里的协议块隐藏为「批注 ×N」标签。
      const offSurgery = installBubbleSurgery()

      // The「N 条注释」chip: conversation.input.dock is the official composer
      // attachment seat; slots.inject waits for the shell's declaration (the
      // ui-conversation todo/queue docks register the same way)。disposer 由
      // cordis 服务代理级联进本 fiber，随 effect 撤销自动回收。
      ctx.slots.inject('conversation.input.dock', () => {
        const offAnnotations = ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'dsh-sidenote-annotations',
          order: 10,
          registrant: 'dsh-sidenote',
        }, createAnnotationChip(store))
        const offReflow = ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'dsh-sidenote-reflow',
          order: 11,
          registrant: 'dsh-sidenote',
        }, createReflowChip(reflow))
        return () => {
          offAnnotations()
          offReflow()
        }
      })

      return () => {
        offInterceptor()
        offSurgery()
        controller.dispose()
        // 同帧 render/unmount 会触发 React 警告——推迟到下一帧。
        setTimeout(() => { root.unmount() })
        host.remove()
      }
    } catch (error) {
      console.error('[dsh-sidenote] annotate setup failed:', error)
      return () => {}
    }
  }, 'dsh-sidenote: annotations')
}
