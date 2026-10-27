/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context, SessionInput } from '../src/client/host/contracts.ts'
import type { ReflowStore } from '../src/client/reflow.ts'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import { submitNativeWithContext } from '../src/client/annotations/NativeComposer.tsx'

const SESSION = 's1'

interface Harness {
  send: (mode?: 'queue' | 'steer') => void
  submitted: string[]
  texts: string[]
  acknowledge: () => void
  activeAnnotations: () => number
  drafts: string[]
  removeAllAnnotations: () => void
  /** 模拟用户输入（inject 等待窗口内的编辑）。 */
  type: (text: string) => void
  draft: () => string
  removedReflow: number[]
  error: () => string | undefined
}

function makeHarness(options: { draft?: string; missingInput?: boolean; withAnnotation?: boolean; rejectFirstSend?: boolean; deferAdmission?: boolean; reflowItems?: { id: number; text: string; sideTitle: string }[] } = {}): Harness {

  const state = { draft: options.draft ?? '', phase: 'plain' as const }
  const submitted: string[] = []
  const texts: string[] = []
  let pendingText = ''
  const drafts: string[] = []
  const sessionState = { sessionId: SESSION, running: false, nodes: [] as unknown[], promptError: undefined as { op: string, error: { message: string } } | undefined }
  let rejectNextSend = options.rejectFirstSend ?? false
  const sessionListeners = new Set<() => void>()
  const session = {
    getSnapshot: () => sessionState,
    subscribe: (fn: () => void) => { sessionListeners.add(fn); return () => { sessionListeners.delete(fn) } },
  }

  const acknowledge = () => {
    sessionState.nodes.push({ kind: 'user', seq: sessionState.nodes.length + 1, content: [{ type: 'text', text: pendingText }] })
    for (const fn of sessionListeners) fn()
  }
  const input = {
    state: {
      getSnapshot: () => state,
      subscribe: () => () => {},
    },
    setDraft: (text: string) => { drafts.push(text); state.draft = text },
    submit: (mode?: string) => {
      submitted.push(mode ?? 'queue')
      texts.push(state.draft)
      if (rejectNextSend) {
        rejectNextSend = false
        sessionState.promptError = { op: 'send', error: { message: 'host rejected this send' } }
        for (const fn of sessionListeners) fn()
        return
      }
      sessionState.promptError = undefined
      pendingText = state.draft
      state.draft = ''
      if (!options.deferAdmission) acknowledge()
    },
    notify: () => {},
  } as unknown as SessionInput

  const ctx = {
    sessions: {
      scope: () => ({}),
      binding: () => ({ session }),
      list: { getSnapshot: () => ({ current: SESSION }) },
    },
    get: (name: string) => (name === 'conversation' ? { input: { for: () => options.missingInput ? undefined : input } } : undefined),
  } as unknown as Context

  const reflowItems = options.reflowItems ?? []
  const removed: number[] = []
  const reflow: ReflowStore = {
    getSnapshot: () => 0,
    subscribe: () => () => {},
    add: () => { throw new Error('unused in this spec') },
    remove: (id: number) => { removed.push(id) },
    clearSession: () => {},
    list: () => reflowItems.filter(item => !removed.includes(item.id)).map(item => ({
      id: item.id,
      sessionId: SESSION,
      sideTitle: item.sideTitle,
      text: item.text,
      createdAt: 1,
    })),
  }

  const store = createAnnotationStore(Date.now, null)
  if (options.withAnnotation !== false) {
    store.add({ sessionId: SESSION, anchorKey: 'k1', text: '原文片段', anchorText: '原文片段', occurrence: 0, note: '' })
  }

  return {
    send: mode => submitNativeWithContext(ctx, store, reflow, SESSION, input.submit.bind(input), mode, 'click'),
    submitted,
    texts,
    acknowledge,
    activeAnnotations: () => store.countActive(SESSION),
    drafts,
    removeAllAnnotations: () => { for (const a of store.listActive(SESSION)) store.remove(a.id) },
    type: (text: string) => { state.draft += text },
    draft: () => state.draft,
    removedReflow: removed,
    error: () => store.getSubmission(SESSION).error,
  }
}

const flushMicrotasks = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

describe('native composer context submission', () => {
  let harness: Harness | undefined

  afterEach(() => {
    harness = undefined
    vi.unstubAllGlobals()
  })

  it('preserves the host-selected steer mode for context-only sends and ignores a repeated submit', async () => {
    harness = makeHarness({ draft: '' })
    harness.send('steer')
    harness.send('steer')
    await flushMicrotasks()
    expect(harness.submitted).toEqual(['steer'])
    expect(harness.drafts[0]).toContain('I annotated 1 passage')
  })

  it('leaves slash commands and ordinary messages on the native path', () => {
    harness = makeHarness({ draft: '/help' })
    harness.send()
    expect(harness.drafts).toEqual([])
    expect(harness.submitted).toEqual(['queue'])
  })

  it.each([
    { withAnnotation: true },
    { withAnnotation: false, reflowItems: [{ id: 1, text: '结论', sideTitle: '侧边' }] },
  ])('keeps context and body together when the input facade disappears: %j', options => {
    harness = makeHarness({ ...options, draft: '保留正文', missingInput: true })
    harness.send()
    expect(harness.submitted).toEqual([])
    expect(harness.removedReflow).toEqual([])
    expect(harness.draft()).toBe('保留正文')
    expect(harness.error()).toBeTruthy()
  })

  it('leaves context-free messages with the native input even when the facade disappears', () => {
    harness = makeHarness({ draft: '普通消息', withAnnotation: false, missingInput: true })
    harness.send()
    expect(harness.submitted).toEqual(['queue'])
    expect(harness.error()).toBeUndefined()
  })

  it.each(['queue', 'steer'] as const)('submits reflow, annotations and body in one native %s message without an independent injection', async mode => {
    harness = makeHarness({ draft: '继续处理正文', reflowItems: [{ id: 1, text: '结论', sideTitle: '侧边' }] })
    vi.stubGlobal('fetch', vi.fn())
    harness.send(mode)
    await flushMicrotasks()
    expect(harness.submitted).toEqual([mode])
    expect(harness.texts[0]).toContain('<答>结论</答>')
    expect(harness.texts[0]).toContain('<quote>原文片段</quote>')
    expect(harness.texts[0]).toMatch(/继续处理正文$/)
    expect(harness.texts[0]!.match(/<reflow /g)).toHaveLength(1)
    expect(harness.removedReflow).toEqual([1])
    expect(harness.activeAnnotations()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends context-only reflows through the same native admission', async () => {
    harness = makeHarness({ withAnnotation: false, reflowItems: [{ id: 1, text: '结论', sideTitle: '侧边' }] })
    harness.send('steer')
    await flushMicrotasks()
    expect(harness.submitted).toEqual(['steer'])
    expect(harness.texts[0]).toContain('<答>结论</答>')
    expect(harness.removedReflow).toEqual([1])
    harness.type('后续输入')
    expect(harness.draft()).toBe('后续输入')
  })

  it('retains the complete batch until the host acknowledges it, even after the draft clears', async () => {
    harness = makeHarness({ draft: '正文', deferAdmission: true, reflowItems: [{ id: 1, text: '结论', sideTitle: '侧边' }] })
    harness.send('queue')
    await flushMicrotasks()
    expect(harness.draft()).toBe('')
    expect(harness.removedReflow).toEqual([])
    expect(harness.activeAnnotations()).toBe(1)
    harness.send('queue')
    expect(harness.submitted).toEqual(['queue'])
    harness.acknowledge()
    await flushMicrotasks()
    expect(harness.removedReflow).toEqual([1])
    expect(harness.activeAnnotations()).toBe(0)
  })

  it('restores a rejected batch and retries each reflow exactly once with its original body', async () => {
    harness = makeHarness({ draft: '保留正文', rejectFirstSend: true, reflowItems: [{ id: 1, text: '结论一', sideTitle: '侧边' }, { id: 2, text: '结论二', sideTitle: '侧边' }] })
    harness.send()
    await flushMicrotasks()
    expect(harness.removedReflow).toEqual([])
    expect(harness.activeAnnotations()).toBe(1)
    expect(harness.draft()).toBe('保留正文')
    expect(harness.error()).toContain('host rejected')
    harness.send()
    await flushMicrotasks()
    expect(harness.removedReflow).toEqual([1, 2])
    expect(harness.activeAnnotations()).toBe(0)
    expect(harness.submitted).toEqual(['queue', 'queue'])
    expect(harness.texts[1]).toBe(harness.texts[0])
    expect(harness.texts[1]!.match(/<reflow /g)).toHaveLength(2)
  })
})
