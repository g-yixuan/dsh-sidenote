/**
 * 「最近关闭的侧边聊天」登记处（L1，localStorage 按主会话分键）：
 * D3 后悔药之一——× 即焚观感不变，但关掉的可重开。
 *
 * 容量：每个主会话最多记 5 条（新者在前）；会话本体仍 archived 在盘
 * （× 只关 Tab），重开 = 开 Tab + meta 预置 childId（面板绑定而非 fork）。
 */
export interface ClosedSideEntry {
  readonly childId: string
  readonly parentSessionId: string
  readonly title: string
  readonly closedAt: number
}

const KEY_PREFIX = 'dsh-sidenote:closed-side:v1:'
const CAP = 5

function readAll(storageKey: string): ClosedSideEntry[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is ClosedSideEntry =>
      typeof e === 'object' && e !== null
      && typeof (e as ClosedSideEntry).childId === 'string'
      && typeof (e as ClosedSideEntry).parentSessionId === 'string'
      && typeof (e as ClosedSideEntry).title === 'string')
  } catch {
    return []
  }
}

export function recordClosedSideChat(parentSessionId: string, entry: ClosedSideEntry): void {
  try {
    const key = KEY_PREFIX + parentSessionId
    const list = [entry, ...readAll(key).filter(e => e.childId !== entry.childId)].slice(0, CAP)
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // 隐私模式/写失败：后悔药缺席不影响主流程。
  }
}

/** 读某主会话的最近关闭列表（新者在前）。 */
export function listClosedSideChats(parentSessionId: string): readonly ClosedSideEntry[] {
  if (typeof localStorage === 'undefined') return []
  return readAll(KEY_PREFIX + parentSessionId)
}

/** 重开消费：从列表移除（重开后若再关会重新入列）。 */
export function dropClosedSideChat(parentSessionId: string, childId: string): void {
  try {
    const key = KEY_PREFIX + parentSessionId
    const list = readAll(key).filter(e => e.childId !== childId)
    if (list.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(list))
  } catch { /* ignore */ }
}
