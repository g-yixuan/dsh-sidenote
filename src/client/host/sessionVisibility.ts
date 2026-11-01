import type { Context, SessionListSnapshot } from './contracts.ts'
import { rootContext } from './sidebar.ts'

const KEY = 'dsh-sidenote:side-sessions:v1'

function readSaved(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const record = value as { ids?: unknown } | null
    return Array.isArray(record?.ids) ? record.ids.filter((id): id is string => typeof id === 'string' && id !== '') : []
  } catch { return [] }
}

/** Browser-local identity outlives tabs and the capped recent-closed menu. */
export function createSessionVisibility() {
  let snapshot = { hidden: new Set(readSaved()) as ReadonlySet<string>, pending: [] as readonly ReadonlySet<string>[] }
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const fn of [...listeners]) fn() }
  const persist = (hidden: ReadonlySet<string>): void => {
    try { localStorage.setItem(KEY, JSON.stringify({ ids: [...hidden] })) } catch { /* Retain in-memory hiding when storage is unavailable. */ }
    snapshot = { ...snapshot, hidden }
    notify()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    hide(...ids: string[]): void {
      const hidden = new Set([...snapshot.hidden, ...readSaved(), ...ids])
      if (hidden.size !== snapshot.hidden.size) persist(hidden)
    },
    watch(): () => void {
      const onStorage = (event: StorageEvent): void => {
        if (event.key !== KEY && event.key !== null) return
        snapshot = { ...snapshot, hidden: new Set(readSaved()) }
        notify()
      }
      window.addEventListener('storage', onStorage)
      return () => { window.removeEventListener('storage', onStorage) }
    },
    /** Start before fork/create: host list events may precede the RPC response. */
    begin(list: SessionListSnapshot): () => void {
      const ids = Array.isArray(list.ids) ? list.ids : Object.keys(list.byId ?? {})
      const known = new Set<string>(ids)
      snapshot = { ...snapshot, pending: [...snapshot.pending, known] }
      notify()
      let finished = false
      return () => {
        if (finished) return
        finished = true
        snapshot = { ...snapshot, pending: snapshot.pending.filter(value => value !== known) }
        notify()
      }
    },
  }
}

export type SessionVisibility = ReturnType<typeof createSessionVisibility>
type VisibilitySnapshot = ReturnType<SessionVisibility['getSnapshot']>

/** Filter only the WorkspaceBrowser's input; bindings and global stores stay intact. */
export function visibleSessionList<T>(list: T, visibility: VisibilitySnapshot): T {
  if (list === null || typeof list !== 'object') return list
  const source = list as { ids?: unknown; byId?: unknown }
  if (!Array.isArray(source.ids) || source.byId === null || typeof source.byId !== 'object') return list
  const hidden = (id: string): boolean => visibility.hidden.has(id) || visibility.pending.some(known => !known.has(id))
  const byId = source.byId as Record<string, unknown>
  if (!Object.keys(byId).some(hidden) && !source.ids.some(hidden)) return list
  return {
    ...list,
    ids: source.ids.filter(id => !hidden(id)),
    byId: Object.fromEntries(Object.entries(byId).filter(([id]) => !hidden(id))),
  }
}

const stores = new WeakMap<Context, SessionVisibility>()
export function sessionVisibilityOf(ctx: Context): SessionVisibility {
  const owner = rootContext(ctx)
  let store = stores.get(owner)
  if (store === undefined) { store = createSessionVisibility(); stores.set(owner, store) }
  return store
}
