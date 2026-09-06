/**
 * 回流通道的受控对象层（Delivery_02 Workitem_04 v2）：侧边聊天的结论以
 * 「待回流对象」进入主会话——主 composer 上方的 chip（可预览/可移除），
 * 发送瞬间由 annotate/send.ts 拦截器与注释协议块一起序列化进消息。
 * 不经草稿文本流（用户裁定：直接进草稿「很脏」）。
 *
 * 气泡留痕：序列化形态是**单块 blockquote**（首行为来源说明），bubble.ts
 * 按首行标记识别并整块折叠为「含侧边回流上下文」标签。
 *
 * 持久化：localStorage 按会话键（dsh-sidenote:reflow:v1:<sessionId>），
 * 与注释 store 同款纪律（刷新不丢、容错 revive、空删键）。
 */
import { t } from './locales.ts'

/** 回流内容不截断（2026-09-06 用户裁定：静默截断让用户不知道内容少了，
 *  「会产生幻觉」；结论是用户亲手选择回流的，全文注入）。 */

export interface ReflowItem {
  readonly id: number
  readonly sessionId: string
  /** 来源侧边聊天 Tab 标题（「侧边 2」）。 */
  readonly sideTitle: string
  /** 结论内容（截断后）。 */
  readonly text: string
  readonly createdAt: number
}

export interface ReflowStore {
  getSnapshot(): number
  subscribe(fn: () => void): () => void
  add(sessionId: string, sideTitle: string, text: string): ReflowItem
  remove(id: number): void
  /** 发送确认后清空该会话的待回流集（一次性消费）。 */
  clearSession(sessionId: string): void
  list(sessionId: string): readonly ReflowItem[]
}

const STORAGE_PREFIX = 'dsh-sidenote:reflow:v1:'

/**
 * 回流块序列化（XML 形态，与注释协议同族）：
 *
 *   <reflow source="侧边 2" reason="用户选择从侧边聊天带回主线">
 *   结论全文（不截断）
 *   </reflow>
 *
 * 来源与意图放在属性里，内容行保持纯净；模型对 XML 包裹的上下文理解最好
 * （Claude 官方推荐形态 / Codex additionalContext 同款思路）。
 */
export function buildReflowBlock(item: ReflowItem): string {
  return `<reflow source="${item.sideTitle}" reason="${t('reflowReason')}">\n${item.text}\n</reflow>`
}

function revive(value: unknown): ReflowItem | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'number' || typeof r.sessionId !== 'string' || r.sessionId === '') return null
  if (typeof r.sideTitle !== 'string' || typeof r.text !== 'string') return null
  return {
    id: r.id,
    sessionId: r.sessionId,
    sideTitle: r.sideTitle,
    text: r.text,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  }
}

export function createReflowStore(
  now: () => number = () => Date.now(),
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null,
): ReflowStore {
  let items: ReflowItem[] = []
  let nextId = 1
  let version = 0
  const listeners = new Set<() => void>()

  const store = storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : storage

  if (store != null) {
    try {
      const keys: string[] = []
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)
        if (typeof key === 'string' && key.startsWith(STORAGE_PREFIX)) keys.push(key)
      }
      for (const key of keys) {
        const parsed: unknown = JSON.parse(store.getItem(key) ?? 'null')
        if (!Array.isArray(parsed)) continue
        for (const raw of parsed) {
          const item = revive(raw)
          if (item === null) continue
          items.push(item)
          nextId = Math.max(nextId, item.id + 1)
        }
      }
    } catch (error) {
      console.warn('[dsh-sidenote] 回流持久化读取失败（按空起步）:', error)
    }
  }

  const persist = (sessionId: string): void => {
    if (store == null) return
    try {
      const mine = items.filter(i => i.sessionId === sessionId)
      const key = STORAGE_PREFIX + sessionId
      if (mine.length === 0) store.removeItem(key)
      else store.setItem(key, JSON.stringify(mine))
    } catch (error) {
      console.warn('[dsh-sidenote] 回流持久化写入失败:', error)
    }
  }

  const notify = (): void => {
    version += 1
    for (const fn of [...listeners]) fn()
  }

  return {
    getSnapshot: () => version,
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    add(sessionId, sideTitle, text) {
      const item: ReflowItem = {
        id: nextId, sessionId, sideTitle, text, createdAt: now(),
      }
      nextId += 1
      items = [...items, item]
      persist(sessionId)
      notify()
      return item
    },
    remove(id) {
      const target = items.find(i => i.id === id)
      if (target === undefined) return
      items = items.filter(i => i.id !== id)
      persist(target.sessionId)
      notify()
    },
    clearSession(sessionId) {
      if (!items.some(i => i.sessionId === sessionId)) return
      items = items.filter(i => i.sessionId !== sessionId)
      persist(sessionId)
      notify()
    },
    list: (sessionId) => items.filter(i => i.sessionId === sessionId),
  }
}
