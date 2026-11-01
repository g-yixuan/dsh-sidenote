/**
 * The annotation store: per-session numbered selection annotations. Pure
 * (DOM-free, React-free) so the whole lifecycle is unit-testable. One instance
 * per plugin activation.
 *
 * Numbering: two layers. The per-session monotonic counter (number) keeps its
 * original semantics — assigned at creation, never reused, never re-packed on
 * delete — and stays the wire <annotation id> so history references remain
 * stable. On top of it, localNumber is the user-facing round-local number:
 * the current active batch of a session is numbered 1..k contiguously by
 * creation order (delete → compact re-pack), frozen at send time. Badges,
 * chip rows and sent cards all display localNumber.
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
  /** Per-session display number assigned at creation; never reused.
   *  Goes on the wire as <annotation id> so history references stay stable. */
  readonly number: number
  /** 用户侧局部编号：本会话当前 active 批次按创建序连续 1..k（不漏号），
   *  发送时冻结；删除后剩余 active 紧凑重排。角标/chip 全显示它。 */
  readonly localNumber: number
  readonly sessionId: string
  /** Source is independent of the send target. Missing fields revive legacy main quotes. */
  readonly sourceSessionId?: string
  readonly sourceSurface?: 'main' | 'side'
  /** `data-chat-anchor-key` of the owning message (re-anchor key). */
  readonly anchorKey: string | undefined
  /** Full human-selected quote; chip truncation is visual only. */
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
  readonly sourceSessionId?: string
  readonly sourceSurface?: 'main' | 'side'
  readonly anchorKey: string | undefined
  readonly text: string
  readonly anchorText: string
  readonly occurrence: number
  readonly note: string
}

export interface AnnotationStore {
  /** Monotonic version, referentially stable between mutations (uSES-ready). */
  getSnapshot(): number
  /** Memory contents remain usable after storage access/quota failures. */
  getStorageStatus(sessionId?: string): 'persistent' | 'memory'
  getSubmission(sessionId: string): { readonly pending: boolean; readonly error?: string }
  setSubmission(sessionId: string, state: { pending: boolean; error?: string }): void
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
    // 旧数据没有局部号：先用全局号兜底，水合后的重排会把 active 修正掉。
    localNumber: typeof a.localNumber === 'number' ? a.localNumber : a.number,
    sessionId: a.sessionId,
    sourceSessionId: typeof a.sourceSessionId === 'string' && a.sourceSessionId !== '' ? a.sourceSessionId : undefined,
    sourceSurface: a.sourceSurface === 'main' || a.sourceSurface === 'side' ? a.sourceSurface : undefined,
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
  const submissions = new Map<string, { pending: boolean; error?: string }>()
  const idleSubmission = { pending: false }

  // localStorage 默认取全局（浏览器环境）；显式传 null = 纯内存（测试）。
  let store = storage ?? null
  if (storage === undefined) {
    try { store = globalThis.localStorage ?? null } catch { store = null }
  }
  let storageStatus: 'persistent' | 'memory' = store === null ? 'memory' : 'persistent'
  const failedStorageSessions = new Set<string>()
  let hydrationFailed = false

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
        let parsed: unknown
        try { parsed = JSON.parse(raw) } catch {
          console.warn('[dsh-sidenote] 跳过损坏的注释记录:', key)
          continue
        }
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
      hydrationFailed = true
      storageStatus = 'memory'
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
      failedStorageSessions.delete(sessionId)
      storageStatus = hydrationFailed || failedStorageSessions.size > 0 ? 'memory' : 'persistent'
    } catch (error) {
      failedStorageSessions.add(sessionId)
      storageStatus = 'memory'
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

  /** 局部编号重排：每个会话的 active 注释按创建序（id 序）连续编 1..k，
   *  已发送的保持冻结值不动（历史角标/引用不能漂移）。只在有变化时替换。 */
  const recomputeLocalNumbers = (): void => {
    const activesBySession = new Map<string, Annotation[]>()
    for (const a of annotations) {
      if (a.state !== 'active') continue
      const bucket = activesBySession.get(a.sessionId)
      if (bucket === undefined) activesBySession.set(a.sessionId, [a])
      else bucket.push(a)
    }
    const patches = new Map<number, number>()
    for (const bucket of activesBySession.values()) {
      bucket.sort((x, y) => x.id - y.id)
      for (let i = 0; i < bucket.length; i += 1) {
        if (bucket[i]!.localNumber !== i + 1) patches.set(bucket[i]!.id, i + 1)
      }
    }
    if (patches.size === 0) return
    annotations = annotations.map(a => {
      const local = patches.get(a.id)
      return local === undefined ? a : { ...a, localNumber: local }
    })
  }

  // 水合后立即规整一次：旧记录没有局部号（revive 用全局号兜底），active 重排为 1..k。
  recomputeLocalNumbers()

  const replace = (id: number, patch: Partial<Annotation>): void => {
    const target = annotations.find(a => a.id === id)
    annotations = annotations.map(a => (a.id === id ? { ...a, ...patch } : a))
    if (target !== undefined) persistTouched([target.sessionId])
    notify()
  }

  return {
    getSnapshot: () => version,
    getStorageStatus: sessionId => sessionId === undefined || hydrationFailed || store === null
      ? storageStatus : failedStorageSessions.has(sessionId) ? 'memory' : 'persistent',
    getSubmission: sessionId => submissions.get(sessionId) ?? idleSubmission,
    setSubmission(sessionId, state) { submissions.set(sessionId, state); notify() },
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    add(draft: AnnotationDraft): Annotation {
      // 全局编号：上游原语义——单调递增、不复用（历史消息引用稳定）。
      const number = (counters.get(draft.sessionId) ?? 0) + 1
      counters.set(draft.sessionId, number)
      // 局部编号：active 恒为 1..k 连续，新来的排 k+1。
      const localNumber = annotations.filter(a => a.sessionId === draft.sessionId && a.state === 'active').length + 1
      const annotation: Annotation = {
        id: nextId,
        number,
        localNumber,
        sessionId: draft.sessionId,
        sourceSessionId: draft.sourceSessionId,
        sourceSurface: draft.sourceSurface,
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
      recomputeLocalNumbers()
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
      // 刚发送的这批局部号就地冻结（保持此刻 1..k），剩余 active 重新紧凑排。
      recomputeLocalNumbers()
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
