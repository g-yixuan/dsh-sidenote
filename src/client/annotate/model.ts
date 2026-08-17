/**
 * The annotation store: per-session numbered selection annotations. Pure
 * (DOM-free, React-free) so the whole lifecycle is unit-testable. One instance
 * per plugin activation; page-level lifecycle — nothing is persisted.
 *
 * Numbering: a per-session monotonic counter assigns each annotation its
 * display number at creation (①②… rendered as plain digits). Numbers are
 * never reused and never re-packed on delete — 删除不重排.
 *
 * State machine per annotation: 'active' (counts in the composer chip, rides
 * the managed draft prefix) → 'sent' (the message it was attached to went
 * out; badge stays on the message flow but the chip no longer counts it).
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
  /** Flip every active annotation of the session to 'sent' (send edge). */
  markSessionSent(sessionId: string): void
  get(id: number): Annotation | undefined
  /** All annotations of a session in creation order (active + sent). */
  list(sessionId: string): readonly Annotation[]
  listActive(sessionId: string): readonly Annotation[]
  countActive(sessionId: string): number
  /** Sessions currently holding any annotation (draft-sync fan-out). */
  sessions(): readonly string[]
}

export function createAnnotationStore(now: () => number = () => Date.now()): AnnotationStore {
  let annotations: Annotation[] = []
  let nextId = 1
  let version = 0
  /** Per-session next display number. */
  const counters = new Map<string, number>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    version += 1
    for (const fn of [...listeners]) fn()
  }

  const replace = (id: number, patch: Partial<Annotation>): void => {
    annotations = annotations.map(a => (a.id === id ? { ...a, ...patch } : a))
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
      notify()
      return annotation
    },
    setNote(id: number, note: string): void {
      if (!annotations.some(a => a.id === id)) return
      replace(id, { note })
    },
    remove(id: number): void {
      if (!annotations.some(a => a.id === id)) return
      annotations = annotations.filter(a => a.id !== id)
      notify()
    },
    markSessionSent(sessionId: string): void {
      if (!annotations.some(a => a.sessionId === sessionId && a.state === 'active')) return
      annotations = annotations.map(a => (
        a.sessionId === sessionId && a.state === 'active' ? { ...a, state: 'sent' } : a
      ))
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
