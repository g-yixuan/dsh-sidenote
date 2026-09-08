/**
 * 全局瞬态通知（P4 确认反馈）：body 级独立 React 根，寿命不随任何 Tab——
 * 「保存为正式会话」后主视图跳转 + 侧聊 Tab 关闭，面板自己的组件树已卸载，
 * toast 必须挂在更长寿的宿主上（annotate overlay 同款 ctx.effect 模式：
 * HMR/插件禁用时 fiber 撤销即清理）。
 */
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../host/contracts.ts'

// 极简事件总线：show(text) → 订阅者刷新；Toast onDone → 清空。
// seq 单调递增——同文案连发也会重启动画（Toast 以 key 换身份重启周期）。
let current: { seq: number; text: string } | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

/** 全局瞬态通知入口（任何模块可调；未挂载宿主时静默丢弃）。 */
export function showToast(text: string): void {
  current = { seq: (current?.seq ?? 0) + 1, text }
  emit()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function ToastHost() {
  const snap = useSyncExternalStore(subscribe, () => current)
  if (snap === null) return null
  return (
    <Toast
      key={snap.seq}
      text={snap.text}
      onDone={() => {
        current = null
        emit()
      }}
    />
  )
}

/** 挂载全局 toast 宿主（registerSideChat 里调用一次）。 */
export function registerToastHost(ctx: Context): void {
  ctx.effect(() => {
    const host = document.createElement('div')
    host.dataset.dshSidenoteToast = ''
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(<ToastHost />)
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'dsh-sidenote: toast host')
}
