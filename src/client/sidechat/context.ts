import { snapshotEntriesOf, snapshotEntriesFromText, splitSnapshotPrefix, type SnapshotEntry } from './snapshot.ts'

/** Read-only rows have event identities, independent of the native side flow. */
export interface ContextEntry extends SnapshotEntry {
  key: string
  messageKey?: string
  images?: readonly unknown[]
}

export function contextEntriesOf(nodes: readonly unknown[]): ContextEntry[] {
  const result = nodes.flatMap(value => {
    const node = value as { seq: number; kind: string; content?: readonly { type?: string; attachment?: unknown }[]; blocks?: readonly { kind?: string; attachment?: unknown }[] }
    const images = [...(node.content ?? []), ...(node.blocks ?? [])]
      .filter(block => ('type' in block ? block.type : undefined) === 'image' || ('kind' in block ? block.kind : undefined) === 'image')
      .map(block => block.attachment).filter(attachment => attachment !== undefined)
    const entries = snapshotEntriesOf([node], undefined, -1)
    if (images.length && entries.length === 0) entries.push({ kind: node.kind === 'assistant' ? 'reply' : 'request', text: '' })
    return entries.flatMap((entry, index): ContextEntry[] => {
      const saved = entry.kind === 'request' ? splitSnapshotPrefix(entry.text) : null
      const prefix = saved ? snapshotEntriesFromText(saved.snapshot).map((part, i) => ({ ...part, key: `${node.seq}:inherited:${i}` })) : []
      const row = { ...entry, text: saved?.rest ?? entry.text, key: `${node.seq}:${entry.kind}`,
        ...(entry.kind === 'reply' ? { messageKey: `a:${node.seq}` } : {}),
        ...(images.length && index === entries.length - 1 ? { images } : {}),
      }
      return [...prefix, row]
    })
  })
  // A side chat can itself be forked. Restore its embedded context in place,
  // applying its latest checkpoint before its own question and answer.
  const checkpoint = result.findLastIndex(entry => entry.kind === 'checkpoint')
  return checkpoint < 0 ? result : result.slice(checkpoint)
}

/** A committed checkpoint replaces the inherited prefix, not its surviving tail. */
export function contextHistory(history: readonly ContextEntry[], progress: readonly SnapshotEntry[]): readonly ContextEntry[] {
  return progress.some(entry => entry.kind === 'checkpoint') ? [] : history
}

/** Saving adds a new end-seed; the first-send cut must NOT move to that seed.
 * Older snapshots lack an explicit cut, so use the seed preceding their input. */
export function savedContextOf(nodes: readonly unknown[], events: readonly { event: { type: string; seq: number } }[], hasMore = false) {
  for (const value of [...nodes].reverse()) {
    const node = value as { kind: string; seq: number; content?: readonly { type?: string; text?: string }[] }
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    const saved = splitSnapshotPrefix(node.content?.find(block => block.type === 'text')?.text ?? '')
    if (!saved) continue
    if (saved.boundarySeq === undefined && hasMore && !events.some(({ event }) => event.type === 'session/end-seed' && event.seq < node.seq)) continue
    const boundarySeq = saved.boundarySeq ?? ((events.findLast(({ event }) => event.type === 'session/end-seed' && event.seq < node.seq)?.event.seq ?? 0) - 1)
    if (!Number.isSafeInteger(boundarySeq) || boundarySeq < -1 || boundarySeq >= node.seq) continue
    return { ...saved, boundarySeq }
  }
  return undefined
}
