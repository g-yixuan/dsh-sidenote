import { snapshotEntriesOf, splitSnapshotPrefix, type SnapshotEntry } from './snapshot.ts'

/** Read-only rows have event identities, independent of the native side flow. */
export interface ContextEntry extends SnapshotEntry {
  key: string
  messageKey?: string
  images?: readonly unknown[]
}

export function contextEntriesOf(nodes: readonly unknown[]): ContextEntry[] {
  const committedSeq = Math.max(-1, ...nodes.filter(value => (value as { kind: string }).kind === 'checkpoint').map(value => (value as { seq: number }).seq))
  const result = nodes.flatMap(value => {
    const node = value as { seq: number; kind: string; content?: readonly { type?: string; attachment?: unknown }[]; blocks?: readonly { kind?: string; attachment?: unknown }[] }
    const entries = snapshotEntriesOf([node], undefined, -1, [], committedSeq)
    // Native assistant/tool images are not part of text-only progress blocks.
    const images = [...(node.content ?? []), ...(node.blocks ?? [])]
      .filter(block => ('type' in block ? block.type : undefined) === 'image' || ('kind' in block ? block.kind : undefined) === 'image')
      .map(block => block.attachment).filter(attachment => attachment !== undefined)
    const usedKeys = new Set<string>()
    return entries.map((entry, index) => {
      const baseKey = `${node.seq}:${entry.kind}`
      const key = usedKeys.has(baseKey) ? `${baseKey}:${index}` : baseKey
      usedKeys.add(baseKey)
      return { ...entry, key,
        ...(node.kind === 'assistant' && entry.kind === 'reply' ? { messageKey: `a:${node.seq}` } : {}),
        ...(node.kind !== 'user' && node.kind !== 'steering' && images.length && index === entries.length - 1 ? { images } : {}),
      }
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
    const node = value as { kind: string; seq: number; content?: readonly { type?: string; text?: string; attachment?: unknown }[] }
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    const saved = splitSnapshotPrefix(node.content?.find(block => block.type === 'text')?.text ?? '')
    if (!saved) continue
    if (saved.boundarySeq === undefined && hasMore && !events.some(({ event }) => event.type === 'session/end-seed' && event.seq < node.seq)) continue
    const boundarySeq = saved.boundarySeq ?? ((events.findLast(({ event }) => event.type === 'session/end-seed' && event.seq < node.seq)?.event.seq ?? 0) - 1)
    if (!Number.isSafeInteger(boundarySeq) || boundarySeq < -1 || boundarySeq >= node.seq) continue
    return { ...saved, boundarySeq, content: node.content }
  }
  return undefined
}
