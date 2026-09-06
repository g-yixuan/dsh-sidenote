/**
 * The annotation store: per-session numbered selection annotations. Pure
 * (DOM-free, React-free) so the whole lifecycle is unit-testable. One instance
 * per plugin activation.
 *
 * Numbering: a per-session monotonic counter assigns each annotation its
 * display number at creation (①②… rendered as plain digits). Numbers are
 * never reused and never re-packed on delete — 删除不重排.
 *
 * State machine per annotation: 'active' (counts in the composer chip, rides
 * the next message via the send interceptor) → 'sent' (the message it was
 * attached to went out; badge turns gray/read-only, chip no longer counts it).
 *
 * 持久化（Delivery_02 起）：每次 mutation 后按会话写 localStorage
 * （`dsh-sidenote:annotations:v1:<sessionId>`），刷新/切会话后重建；
 * 会话清空时删键。storage 不可用（测试/隐私模式）时退化为纯内存。
 */
export interface Annotation {
  /** Store-unique identity (monotonic across sessions). */
  readonly id: number
  /** Per-session display number assigned at creation; never reused. */
  readonly number: number
  readonly sessionId: string
  /** `data-chat-anchor-key` of the owning message (re-anchor key). */
  readonly anchorKey: string | undefined
  /** Truncated quote text (what the model and the chip see). */
  readonly text: string
  /** Full selection text (re-anchor needle; untruncated). */
  readonly anchorText: string
  /** 0-based ordinal of the quote's occurrence inside the anchor element. */
  readonly occurrence: number
  /** User-written note; '' means 纯引用. */
  readonly note: string
  readonly state: 'active' | 'sent'
  readonly createdAt: number
}

export interface AnnotationDraft {
  readonly sessionId: string
  readonly anchorKey: string | undefined
  readonly text: string
  readonly anchorText: string
  readonly occurrence: number
  readonly note: string
}

export interface AnnotationStore {
  /** Monotonic version, referentially stable between mutations (uSES-ready). */
  getSnapshot(): number
  subscribe(fn: () => void): () => void
  /** Create an active annotation; returns it (id/number assigned). */
  add(draft: AnnotationDraft): Annotation
  setNote(id: number, note: string): void
  remove(id: number): void
  /** 把指定 id 的 active 注释翻为 'sent'（发送拦截器只翻当时拼进消息的
   *  那批——窗口内新增的注释不得误标，C2 P1-3）。 */
  markSent(ids: readonly number[]): void
  get(id: number): Annotation | undefined
  /** All annotations of a session in creation order (active + sent). */
  list(sessionId: string): readonly Annotation[]
  listActive(sessionId: string): readonly Annotation[]
  countActive(sessionId: string): number
  /** Sessions currently holding any annotation (draft-sync fan-out). */
  sessions(): readonly string[]
}

/** localStorage 键前缀（按会话分键）。 */
export const STORAGE_PREFIX = 'dsh-sidenote:annotations:v1:'

/** 持久化条目的宽松校验（字段缺失/类型漂移 → 丢弃该条，不抛错）。 */
function reviveStored(value: unknown): Annotation | null {
  if (typeof value !== 'object' || value === null) return null
  const a = value as Record<string, unknown>
  if (typeof a.id !== 'number' || typeof a.number !== 'number') return null
  if (typeof a.sessionId !== 'string' || a.sessionId === '') return null
  if (typeof a.text !== 'string' || typeof a.anchorText !== 'string') return null
  if (typeof a.occurrence !== 'number') return null
  if (a.state !== 'active' && a.state !== 'sent') return null
  return {
    id: a.id,
    number: a.number,
    sessionId: a.sessionId,
    anchorKey: typeof a.anchorKey === 'string' && a.anchorKey !== '' ? a.anchorKey : undefined,
    text: a.text,
    anchorText: a.anchorText,
    occurrence: a.occurrence,
    note: typeof a.note === 'string' ? a.note : '',
    state: a.state,
    createdAt: typeof a.createdAt === 'number' ? a.createdAt : 0,
  }
}

export function createAnnotationStore(
  now: () => number = () => Date.now(),
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null,
): AnnotationStore {
  let annotations: Annotation[] = []
  let nextId = 1
  let version = 0
  /** Per-session next display number. */
  const counters = new Map<string, number>()
  const listeners = new Set<() => void>()

  // localStorage 默认取全局（浏览器环境）；显式传 null = 纯内存（测试）。
  const store: typeof storage = storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : storage

  // ── 启动水合：扫描前缀键，容错 revive；编号计数器取既有最大值 ──
  if (store != null) {
    try {
      const keys: string[] = []
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)
        if (typeof key === 'string' && key.startsWith(STORAGE_PREFIX)) keys.push(key)
      }
      for (const key of keys) {
        const raw = store.getItem(key)
        if (raw === null) continue
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) continue
        for (const item of parsed) {
          const revived = reviveStored(item)
          if (revived === null) continue
          annotations.push(revived)
          counters.set(revived.sessionId, Math.max(counters.get(revived.sessionId) ?? 0, revived.number))
          nextId = Math.max(nextId, revived.id + 1)
        }
      }
    } catch (error) {
      console.warn('[dsh-sidenote] 注释持久化读取失败（按空起步）:', error)
    }
  }

  /** 把一个会话的注释写回 localStorage（空则删键）。 */
  const persistSession = (sessionId: string): void => {
    if (store == null) return
    try {
      const items = annotations.filter(a => a.sessionId === sessionId)
      const key = STORAGE_PREFIX + sessionId
      if (items.length === 0) store.removeItem(key)
      else store.setItem(key, JSON.stringify(items))
    } catch (error) {
      console.warn('[dsh-sidenote] 注释持久化写入失败:', error)
    }
  }

  /** mutation 后落盘：受影响会话可能不止一个（markSessionSent 单会话）。 */
  const persistTouched = (touched: readonly string[]): void => {
    for (const sessionId of new Set(touched)) persistSession(sessionId)
  }

  const notify = (): void => {
    version += 1
    for (const fn of [...listeners]) fn()
  }

  const replace = (id: number, patch: Partial<Annotation>): void => {
    const target = annotations.find(a => a.id === id)
    annotations = annotations.map(a => (a.id === id ? { ...a, ...patch } : a))
    if (target !== undefined) persistTouched([target.sessionId])
    notify()
  }

  return {
    getSnapshot: () => version,
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    add(draft: AnnotationDraft): Annotation {
      const number = (counters.get(draft.sessionId) ?? 0) + 1
      counters.set(draft.sessionId, number)
      const annotation: Annotation = {
        id: nextId,
        number,
        sessionId: draft.sessionId,
        anchorKey: draft.anchorKey,
        text: draft.text,
        anchorText: draft.anchorText,
        occurrence: draft.occurrence,
        note: draft.note,
        state: 'active',
        createdAt: now(),
      }
      nextId += 1
      annotations = [...annotations, annotation]
      persistTouched([draft.sessionId])
      notify()
      return annotation
    },
    setNote(id: number, note: string): void {
      if (!annotations.some(a => a.id === id)) return
      replace(id, { note })
    },
    remove(id: number): void {
      const target = annotations.find(a => a.id === id)
      if (target === undefined) return
      annotations = annotations.filter(a => a.id !== id)
      persistTouched([target.sessionId])
      notify()
    },
    markSent(ids: readonly number[]): void {
      if (ids.length === 0) return
      const idSet = new Set(ids)
      if (!annotations.some(a => idSet.has(a.id) && a.state === 'active')) return
      const touched = new Set<string>()
      annotations = annotations.map(a => {
        if (!idSet.has(a.id) || a.state !== 'active') return a
        touched.add(a.sessionId)
        return { ...a, state: 'sent' }
      })
      persistTouched([...touched])
      notify()
    },
    get(id: number): Annotation | undefined {
      return annotations.find(a => a.id === id)
    },
    list(sessionId: string): readonly Annotation[] {
      return annotations.filter(a => a.sessionId === sessionId)
    },
    listActive(sessionId: string): readonly Annotation[] {
      return annotations.filter(a => a.sessionId === sessionId && a.state === 'active')
    },
    countActive(sessionId: string): number {
      return annotations.reduce((n, a) => n + (a.sessionId === sessionId && a.state === 'active' ? 1 : 0), 0)
    },
    sessions(): readonly string[] {
      return [...new Set(annotations.map(a => a.sessionId))]
    },
  }
}
