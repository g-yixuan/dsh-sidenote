/** Closed side-chat recovery records, grouped by parent and ordered newest first. */
import { parseSideChatMeta, type SideChatMeta } from './model.ts'

export interface ClosedSideEntry {
  readonly childId: string
  readonly parentSessionId: string
  readonly title: string
  readonly topic?: string
  readonly closedAt: number
  /** Native tab recovery identity; manual reopen continues to use childId. */
  readonly tabId?: string
  readonly savedMeta?: SideChatMeta & { number?: number }
}

const LEGACY_PREFIX = 'dsh-sidenote:closed-side:v1:'
const KEY_PREFIX = 'dsh-sidenote:closed-side:v2:'
const parentPrefix = (parent: string): string => `${KEY_PREFIX}${encodeURIComponent(parent)}:`
const entryKey = (parent: string, child: string): string => parentPrefix(parent) + encodeURIComponent(child)

interface StoredEntry {
  readonly entry: ClosedSideEntry | null
  readonly writtenAt: number
}

function isEntry(value: unknown): value is ClosedSideEntry {
  if (value === null || typeof value !== 'object') return false
  const e = value as Partial<ClosedSideEntry>
  return typeof e.childId === 'string' && typeof e.parentSessionId === 'string' && typeof e.title === 'string'
}

function readLegacy(parent: string): ClosedSideEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEGACY_PREFIX + parent) ?? 'null')
    return Array.isArray(value) ? value.filter(isEntry).filter(entry => entry.parentSessionId === parent) : []
  } catch { return [] }
}

function storageKeys(store: Storage): string[] {
  try { return Object.keys(store) } catch { return [] }
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try { return globalThis[kind] } catch { return undefined }
}

function readStored(store: Storage | undefined, key: string): StoredEntry | undefined {
  try {
    const raw = store?.getItem(key)
    if (raw == null) return undefined
    const value = JSON.parse(raw) as Partial<StoredEntry> | null
    if (value && typeof value.writtenAt === 'number' && (value.entry === null || isEntry(value.entry))) return value as StoredEntry
  } catch { /* Ignore malformed records individually. */ }
  return undefined
}

function encodeStored(key: string, entry: ClosedSideEntry | null): string {
  const writtenAt = Math.max(Date.now(), (readStored(browserStorage('localStorage'), key)?.writtenAt ?? 0) + 1)
  return JSON.stringify({ entry, writtenAt })
}

/** A single key per child prevents closing/removing one chat from overwriting another
 * window's history. Legacy arrays remain readable; a null entry masks a removed v1 record. */
export function listClosedSideChats(parentSessionId: string): readonly ClosedSideEntry[] {
  const entries = new Map(readLegacy(parentSessionId).map(entry => [entry.childId, entry]))
  const changes = new Map<string, StoredEntry>()
  const prefix = parentPrefix(parentSessionId)
  for (const store of [browserStorage('localStorage'), browserStorage('sessionStorage')]) {
    if (!store) continue
    for (const key of storageKeys(store)) {
      if (!key.startsWith(prefix)) continue
      try {
        const childId = decodeURIComponent(key.slice(prefix.length))
        const value = readStored(store, key)
        if (!value || value.writtenAt <= (changes.get(childId)?.writtenAt ?? -1)) continue
        if (value.entry === null || (value.entry.childId === childId && value.entry.parentSessionId === parentSessionId)) changes.set(childId, value)
      } catch { /* Ignore malformed records individually. */ }
    }
  }
  for (const [childId, change] of changes) {
    if (change.entry === null) entries.delete(childId)
    else entries.set(childId, change.entry)
  }
  return [...entries.values()].sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
}

export function recordClosedSideChat(parentSessionId: string, entry: ClosedSideEntry): boolean {
  const key = entryKey(parentSessionId, entry.childId)
  const value = encodeStored(key, entry)
  try {
    localStorage.setItem(key, value)
    try { sessionStorage.removeItem(key) } catch { /* The durable record remains available. */ }
    return true
  } catch {
    // Preserve recovery in the current browser tab even if persistent storage is full.
    try { sessionStorage.setItem(key, value) } catch { /* Both stores are unavailable. */ }
    console.warn('[dsh-sidenote] Could not persist a closed side chat in local storage.')
    return false
  }
}

/** Share the recovery payload between pagehide and true native-tab closure. */
export function rememberSideChat(tabId: string, title: string, meta: unknown): boolean {
  const current = parseSideChatMeta(meta)
  if (!current.childId || !current.parentSessionId) return true
  return recordClosedSideChat(current.parentSessionId, {
    childId: current.childId, parentSessionId: current.parentSessionId, tabId, title,
    savedMeta: { ...current, number: (meta as { number?: number }).number },
    ...(current.topic ? { topic: current.topic } : {}), closedAt: Date.now(),
  })
}

/** Existing recovery records can seed the durable visibility index on upgrade. */
export function allClosedSideChats(): readonly ClosedSideEntry[] {
  const parents = new Set<string>()
  for (const store of [browserStorage('localStorage'), browserStorage('sessionStorage')]) for (const key of store ? storageKeys(store) : []) {
    if (key.startsWith(LEGACY_PREFIX)) parents.add(key.slice(LEGACY_PREFIX.length))
    else if (key.startsWith(KEY_PREFIX)) {
      try { parents.add(decodeURIComponent(key.slice(KEY_PREFIX.length).split(':')[0]!)) } catch { /* Ignore malformed keys. */ }
    }
  }
  return [...parents].flatMap(listClosedSideChats)
}

/** Reopening consumes the record; closing the same child later writes it again. */
export function dropClosedSideChat(parentSessionId: string, childId: string): boolean {
  try {
    const key = entryKey(parentSessionId, childId)
    const legacy = readLegacy(parentSessionId)
    const wasLegacy = legacy.some(entry => entry.childId === childId)
    const durable = readStored(browserStorage('localStorage'), key)
    const fallback = readStored(browserStorage('sessionStorage'), key)
    if (!wasLegacy && !durable?.entry && !fallback?.entry) return true
    const tombstone = encodeStored(key, null)
    try { localStorage.setItem(key, tombstone) }
    catch (error) {
      if (!wasLegacy && !durable?.entry && fallback?.entry) {
        sessionStorage.removeItem(key)
        return true
      }
      if (!wasLegacy) throw error
      // A full quota may reject a new key. Shrink the old array to make room
      // for the tombstone without discarding any of its other children.
      const remaining = legacy.filter(entry => entry.childId !== childId)
      if (remaining.length === 0) localStorage.removeItem(LEGACY_PREFIX + parentSessionId)
      else localStorage.setItem(LEGACY_PREFIX + parentSessionId, JSON.stringify(remaining))
      localStorage.setItem(key, tombstone)
    }
    try { sessionStorage.removeItem(key) } catch { /* The durable tombstone masks older recovery data. */ }
    return true
  } catch { return false }
}

/** Revoke an old tab occurrence's automatic restoration identity while keeping manual history. */
export function forgetClosedTabBinding(parentSessionId: string, tabId: string): void {
  for (const entry of listClosedSideChats(parentSessionId)) {
    if (entry.tabId !== tabId) continue
    const { tabId: _oldTab, ...rest } = entry
    recordClosedSideChat(parentSessionId, rest)
  }
}
