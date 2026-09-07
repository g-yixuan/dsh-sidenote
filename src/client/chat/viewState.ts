/**
 * 消息流折叠态的外置 store（L1，react-free）：每条卡/思考块的展开状态按
 * 消息 key 寄存——组件卸载/重挂（Tab 切换、列表重渲）不丢展开态
 * （P0-2 状态零丢失的架构约束；刷新级持久化归 WI-03）。
 * 默认折叠（Delivery_03 裁决规则一：密度于默认态）。
 */

export interface FoldStore {
  getSnapshot(): number
  subscribe(fn: () => void): () => void
  isOpen(key: string): boolean
  toggle(key: string): void
  /** 全部收起/展开（P1-4 密度管理「一键折叠工具流」）。keys = 当前可见键集。 */
  setAll(keys: readonly string[], open: boolean): void
}

export function createFoldStore(): FoldStore {
  const open = new Map<string, boolean>()
  let version = 0
  const listeners = new Set<() => void>()
  const notify = (): void => {
    version += 1
    for (const fn of [...listeners]) fn()
  }
  return {
    getSnapshot: () => version,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    isOpen: (key) => open.get(key) === true,
    toggle(key) {
      open.set(key, open.get(key) !== true)
      notify()
    },
    setAll(keys, value) {
      for (const key of keys) open.set(key, value)
      notify()
    },
  }
}
