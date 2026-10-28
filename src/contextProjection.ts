import { splitSnapshotPrefix } from './snapshotProtocol.ts'

/** The host caches this scalar alongside its other projections, including on forks. */
const sequenceSchema = {
  parse(value: unknown): number | null {
    if (value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
    throw new Error('Invalid sidenote context sequence')
  },
}

export const contextProjection = {
  key: 'sidenoteContext',
  stateVersion: 1,
  stateSchema: sequenceSchema,
  init: (): number | null => null,
  apply(state: number | null, event: { type: string; seq: number; data: { content?: readonly { type: string; text?: string }[] } }): number | null {
    if (event.type !== 'user/message') return state
    const text = event.data.content?.find(block => block.type === 'text')?.text
    return text && splitSnapshotPrefix(text) ? event.seq : state
  },
  wire: { viewSchema: sequenceSchema, view: (state: number | null) => state },
}
