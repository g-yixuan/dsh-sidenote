import { snapshotEntriesOf, type SnapshotEntry } from './snapshot.ts'

/** Read-only rows have event identities, independent of the native side flow. */
export interface ContextEntry extends SnapshotEntry {
  key: string
  messageKey?: string
  images?: readonly unknown[]
}

export function contextEntriesOf(nodes: readonly unknown[]): ContextEntry[] {
  return nodes.flatMap(value => {
    const node = value as { seq: number; kind: string; content?: readonly { type?: string; attachment?: unknown }[]; blocks?: readonly { kind?: string; attachment?: unknown }[] }
    const images = [...(node.content ?? []), ...(node.blocks ?? [])]
      .filter(block => ('type' in block ? block.type : undefined) === 'image' || ('kind' in block ? block.kind : undefined) === 'image')
      .map(block => block.attachment).filter(attachment => attachment !== undefined)
    const entries = snapshotEntriesOf([node], undefined, -1)
    if (images.length && entries.length === 0) entries.push({ kind: node.kind === 'assistant' ? 'reply' : 'request', text: '' })
    return entries.map((entry, index) => ({ ...entry, key: `${node.seq}:${entry.kind}`,
      ...(entry.kind === 'reply' ? { messageKey: `a:${node.seq}` } : {}),
      ...(images.length && index === entries.length - 1 ? { images } : {}),
    }))
  })
}

/** A committed checkpoint replaces the inherited prefix, not its surviving tail. */
export function contextHistory(history: readonly ContextEntry[], progress: readonly SnapshotEntry[]): readonly ContextEntry[] {
  return progress.some(entry => entry.kind === 'checkpoint') ? [] : history
}
