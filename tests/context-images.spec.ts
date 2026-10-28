/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { submitAnnotations } from '../src/client/annotations/send.ts'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import { serializeSnapshot, snapshotEntriesFromText } from '../src/client/sidechat/snapshot.ts'
import { snapshotImages, withoutSnapshotImages } from '../src/snapshotProtocol.ts'
import type { Context, SessionInput } from '../src/client/host/contracts.ts'

afterEach(() => vi.unstubAllGlobals())

it.each(['accepted', 'rejected', 'download-failed', 'prepend-failed'])('keeps carried images in the same native admission and rolls back only that batch: %s', async outcome => {
  const attachment = { attachmentId: 'same-image', mediaType: 'image/png' }
  const prefix = serializeSnapshot([{ kind: 'request', text: '', images: [attachment] }], new Date(), 0)
  const state = { draft: 'question', phase: 'plain', attachmentIds: ['own-image'], draftRev: 1 }
  const notices = new Set<() => void>()
  const sessionState = { nodes: [] as unknown[], promptError: undefined as unknown }
  const session = { getSnapshot: () => sessionState, subscribe: (fn: () => void) => { notices.add(fn); return () => notices.delete(fn) } }
  const released = vi.fn(), submitted: unknown[] = []
  const input = {
    ...(outcome === 'prepend-failed' ? { insertText: () => false } : {}),
    state: { getSnapshot: () => state, subscribe: () => () => {} },
    setDraft: (text: string) => { state.draft = text },
    addAttachments: (ids: string[]) => { state.attachmentIds.push(...ids); return true },
    removeAttachment: (id: string) => { state.attachmentIds = state.attachmentIds.filter(value => value !== id) },
    submit: () => {
      submitted.push([...state.attachmentIds])
      if (outcome === 'rejected') sessionState.promptError = { op: 'send', error: { message: 'rejected' } }
      else { sessionState.nodes.push({ kind: 'user', seq: 1, content: [{ type: 'text', text: state.draft }] }); state.draft = ''; state.attachmentIds = [] }
      for (const notify of [...notices]) notify()
    },
  } as unknown as SessionInput
  const ctx = { sessions: { binding: () => ({ session }) }, get: (key: string) => key === 'uiConversation' ? { imageUrl: async () => 'blob:canonical' } : {
    createDrafts: () => [{ id: 'carried-image', kind: 'image', previewUrl: 'blob:copy' }], resolveDraftAttachments: () => [], releaseDraftAttachment: released,
  } } as unknown as Context
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: outcome !== 'download-failed', blob: async () => new Blob(['bytes'], { type: 'image/png' }) })))
  const accepted = await submitAnnotations({ ctx, input, sessionId: 'child', store: createAnnotationStore(Date.now, null), annotations: [], leadingBlocks: [prefix], contextImages: { sessionId: 'parent', attachments: [attachment, attachment] } })
  expect(accepted).toBe(outcome === 'accepted')
  expect(submitted).toEqual(['download-failed', 'prepend-failed'].includes(outcome) ? [] : [['own-image', 'carried-image']])
  if (outcome !== 'accepted') { expect(state.draft).toBe('question'); expect(state.attachmentIds).toEqual(['own-image']) }
  expect(released.mock.calls).toHaveLength(['rejected', 'prepend-failed'].includes(outcome) ? 1 : 0)
  const own = { type: 'image', attachment }, carried = { type: 'image', attachment }
  expect(withoutSnapshotImages([own, { type: 'text', text: prefix }, carried], prefix)).toEqual([own, { type: 'text', text: prefix }])
})


it('uses admitted image references when host normalization changes a carried id', () => {
  const source = { attachmentId: 'source-id', mediaType: 'image/png' }
  const admitted = { attachmentId: 'normalized-id', mediaType: 'image/webp' }
  const own = { type: 'image', attachment: source }
  const wire = serializeSnapshot([{ kind: 'request', text: 'inherited', images: [source] }], new Date(), 0)
  const content = [own, { type: 'text', text: wire }, { type: 'image', attachment: admitted }]
  expect(snapshotEntriesFromText(wire, content)[0]?.images).toEqual([admitted])
  expect(withoutSnapshotImages(content, wire)).toEqual([own, { type: 'text', text: wire }])
  const collision = serializeSnapshot([{ kind: 'request', text: '', images: [source, { ...source, attachmentId: 'another-source' }] }], new Date(), 0)
  const same = { type: 'image', attachment: admitted }
  expect(withoutSnapshotImages([own, same, same], collision)).toEqual([own])
  expect(snapshotEntriesFromText(collision, [own, same, same])[0]?.images).toEqual([admitted, admitted])
})

it('does not treat an images attribute mentioned in ordinary text as an attachment', () => {
  const text = 'Example: images="[{&quot;attachmentId&quot;:&quot;not-an-attachment&quot;}]"'
  const snapshot = serializeSnapshot([{ kind: 'request', text }], new Date(), 0)
  expect(snapshotImages(snapshot)).toEqual([])
  expect(snapshotEntriesFromText(snapshot)).toEqual([{ kind: 'request', text }])
})
