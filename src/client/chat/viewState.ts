/**
 * 消息流折叠态的外置 store（L1，react-free）：每条卡/思考块的展开状态按
 * 消息 key 寄存——组件卸载/重挂（Tab 切换、列表重渲）不丢展开态。
 * 默认折叠（Delivery_03 裁决规则一：密度于默认态）。
 *
 * 持久化（WI-03 P0-2）：传 storageKey 即按 localStorage 持久化（容错 revive，
 * 空删键）——刷新/重启后展开态恢复。
 */

export interface FoldStore {
  getSnapshot(): number
  subscribe(fn: () => void): () => void
  isOpen(key: string): boolean
  /** 用户是否显式碰过该键（思考块「流式默认展开」要区分未触碰 vs 显式收起）。 */
  has(key: string): boolean
  toggle(key: string): void
  /** 全部收起/展开（P1-4 密度管理「一键折叠工具流」）。keys = 当前可见键集。 */
  setAll(keys: readonly string[], open: boolean): void
}

export function createFoldStore(storageKey?: string): FoldStore {
  const open = new Map<string, boolean>()
  let version = 0
  const listeners = new Set<() => void>()

  // 水合（容错：坏 JSON/非对象按空起步）。
  if (storageKey !== undefined && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (v === true) open.set(k, true)
          }
        }
      }
    } catch (error) {
      console.warn('[dsh-sidenote] 折叠态恢复失败（按空起步）:', error)
    }
  }

  const persist = (): void => {
    if (storageKey === undefined || typeof localStorage === 'undefined') return
    try {
      if (open.size === 0) localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(open)))
    } catch {
      // 存储满/隐私模式：放弃持久化不影响功能。
    }
  }

  const notify = (): void => {
    version += 1
    for (const fn of [...listeners]) fn()
    persist()
  }
  return {
    getSnapshot: () => version,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    isOpen: (key) => open.get(key) === true,
    has: (key) => open.has(key),
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
