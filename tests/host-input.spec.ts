import { describe, expect, it, vi } from 'vitest'
import type { SessionInput } from '../src/client/host/contracts.ts'
import { addInputAttachments, inputAttachmentIds, prependInputText, stripInputPrefix } from '../src/client/host/input.ts'

describe('host input boundaries', () => {
  it('keeps rich references by using the scoped insertion verb', () => {
    const state = { draft: '@readme question', phase: 'plain' as const, draftRev: 4, occurrences: [{ occurrenceId: 1, offset: 0, length: 7, source: 'file', ref: 'readme' }] }
    const replace = vi.fn()
    const insert = vi.fn((text: string, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev) return false
      state.draft = state.draft.slice(0, span.start) + text + state.draft.slice(span.end)
      state.draftRev += 1
      state.occurrences[0]!.offset += text.length - (span.end - span.start)
      return true
    })
    const input = { state: { getSnapshot: () => state }, setDraft: replace, insertText: insert } as unknown as SessionInput
    expect(prependInputText(input, 'quote\n\n')).toBe(true)
    expect(state.occurrences).toMatchObject([{ ref: 'readme', offset: 7 }])
    expect(stripInputPrefix(input, 'quote\n\n')).toBe(true)
    expect(state.draft).toBe('@readme question')
    expect(state.occurrences).toMatchObject([{ ref: 'readme', offset: 0 }])
    expect(replace).not.toHaveBeenCalled()
  })

  it('refuses a replacement that would silently flatten rich references', () => {
    const replace = vi.fn()
    const input = { state: { getSnapshot: () => ({ draft: '@file', phase: 'plain', occurrences: [{}] }) }, setDraft: replace } as unknown as SessionInput
    expect(prependInputText(input, 'quote\n\n')).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not strip a newer user draft or mutate a locked input', () => {
    const replace = vi.fn()
    const input = { state: { getSnapshot: () => ({ draft: 'new question', phase: 'submitting' }) }, setDraft: replace } as unknown as SessionInput
    expect(prependInputText(input, 'quote\n\n')).toBe(false)
    expect(stripInputPrefix(input, 'quote\n\n')).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })

  it('uses the active attachment dialect without retrying a rejected modern admission', () => {
    const old = vi.fn(() => true)
    const modern = vi.fn(() => false)
    const input = { state: { getSnapshot: () => ({ attachmentIds: ['new'], imageIds: ['old'] }) }, addAttachments: modern, addImages: old } as unknown as SessionInput
    expect(inputAttachmentIds(input)).toEqual(['new'])
    expect(addInputAttachments(input, ['a'])).toBe(false)
    expect(modern).toHaveBeenCalledExactlyOnceWith(['a'])
    expect(old).not.toHaveBeenCalled()
  })
})
