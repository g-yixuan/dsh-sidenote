/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context, SessionInput } from '../src/client/host/contracts.ts'
import type { ReflowStore } from '../src/client/reflow.ts'
import { createAnnotationStore } from '../src/client/annotations/model.ts'
import { registerSubmissionExtras } from '../src/client/annotations/submissionExtras.ts'
import { submitControlledInput } from '../src/client/annotations/send.ts'
import { submitNativeWithContext } from '../src/client/annotations/NativeComposer.tsx'
import { dropSideChatMeta, readSideChatMeta, switchSideChatSession, writeSideChatMeta } from '../src/client/sidechat/metaStore.ts'

const SESSION = 's1'

interface Harness {
  ctx: Context
  input: SessionInput
  store: ReturnType<typeof createAnnotationStore>
  reflow: ReflowStore
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
      getSnapshot: () => ({ ...state }),
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
    ctx, input, store, reflow,
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
    localStorage.clear()
  })

  it.each([false, true])('waits for the unmounted chat projection and releases subscriptions (cancel=%s)', async cancel => {
    const source = makeHarness({ draft: '等待消息确认数据', withAnnotation: false })
    const controller = new AbortController()
    const listeners = new Set<() => void>()
    let loaded = false
    const ctx = { ...source.ctx, get: (name: string) => name === 'uiConversation' ? {
      binding: () => ({ target: () => ({
        getSnapshot: () => loaded ? { legacy: source.ctx.sessions.binding(SESSION)!.session.getSnapshot() } : undefined,
        subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      }) }),
    } : source.ctx.get(name) } as unknown as Context
    const off = registerSubmissionExtras(SESSION, {
      needsFirstSend: () => true, firstSendPrefix: async () => ({ text: '上下文', signal: controller.signal }), onAccepted: () => {}, onSubmitText: () => {},
    })
    try {
      const sending = submitControlledInput(ctx, source.store, source.reflow, SESSION)
      await flushMicrotasks()
      expect(source.texts).toEqual([])
      if (cancel) controller.abort()
      else { loaded = true; for (const listener of [...listeners]) listener() }
      expect(await sending).toBe(!cancel)
      expect(source.texts).toHaveLength(cancel ? 0 : 1)
      expect(source.draft()).toBe(cancel ? '等待消息确认数据' : '')
      expect(listeners.size).toBe(0)
    } finally { off() }
  })

  it.each(['storage-both', 'storage-local', 'storage-window', 'closed', 'replaced', 'aborted', 'edited', 'quoted'])(
    'keeps the original draft and error without sending when handoff fails: %s', async failure => {
      const source = makeHarness({ draft: '保留我的问题', withAnnotation: false })
      const target = makeHarness({ withAnnotation: false })
      let ready!: () => void
      const waiting = new Promise<void>(resolve => { ready = resolve })
      const controller = new AbortController()
      const ctx = {
        ...source.ctx,
        sessions: { ...source.ctx.sessions,
          retain: () => ({ ready: waiting.then(() => target.ctx.sessions.binding('fresh')), release: () => {} }),
        },
      } as unknown as Context
      writeSideChatMeta({ sessionId: 'parent', tabId: 'tab', childId: SESSION, nativeAddress: 'instance', createdAt: 1, number: 1 })
      const previous = readSideChatMeta('parent', 'tab')!
      const dispose = vi.fn(), accepted = vi.fn()
      const off = registerSubmissionExtras(SESSION, {
        needsFirstSend: () => true,
        firstSendPrefix: async () => ({ text: '<mainline-progress-snapshot>tail</mainline-progress-snapshot>', signal: controller.signal,
          target: { sessionId: 'fresh', input: target.input, activate: () => switchSideChatSession(previous, 'fresh', 12), dispose } }),
        onAccepted: accepted, onSubmitText: () => {},
      })
      try {
        const sending = submitControlledInput(ctx, source.store, source.reflow, SESSION)
        await flushMicrotasks()
        if (failure.startsWith('storage')) {
          const setItem = Storage.prototype.setItem
          vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (failure === 'storage-both' || this === (failure === 'storage-local' ? localStorage : sessionStorage)) throw new DOMException('full', 'QuotaExceededError')
            setItem.call(this, key, value)
          })
        } else if (failure === 'closed') dropSideChatMeta('parent', 'tab')
        else if (failure === 'replaced') writeSideChatMeta({ ...previous, nativeAddress: 'replacement' })
        else if (failure === 'aborted') controller.abort()
        else if (failure === 'edited') source.type('（修改）')
        else source.store.add({ sessionId: SESSION, anchorKey: 'new', text: '引用', anchorText: '引用', occurrence: 0, note: '' })
        ready()
        expect(await sending).toBe(false)
        expect(source.draft()).toBe(failure === 'edited' ? '保留我的问题（修改）' : '保留我的问题')
        expect(source.error()).toBeTruthy()
        expect(target.texts).toEqual([])
        expect(source.texts).toEqual([])
        expect(accepted).not.toHaveBeenCalled()
        expect(dispose).toHaveBeenCalledOnce()
        expect(source.store.getSubmission(SESSION).pending).toBe(false)
        expect(source.store.getSubmission('fresh').pending).toBe(false)
        if (failure.startsWith('storage')) {
          for (const store of [localStorage, sessionStorage]) expect(JSON.parse(store.getItem('dsh-sidenote:side-meta:v1:parent:tab')!).childId).toBe(SESSION)
        }
      } finally { off() }
    },
  )

  it('keeps the adopted target when the tab closes after native submit but before acknowledgement', async () => {
    const source = makeHarness({ draft: '已提交的问题', withAnnotation: false })
    const target = makeHarness({ withAnnotation: false, deferAdmission: true })
    const controller = new AbortController()
    const ctx = { ...source.ctx, sessions: { ...source.ctx.sessions, binding: (id: string) => (id === SESSION ? source : target).ctx.sessions.binding(id) } } as unknown as Context
    writeSideChatMeta({ sessionId: 'parent', tabId: 'tab', childId: SESSION, createdAt: 1, number: 1 })
    const previous = readSideChatMeta('parent', 'tab')!
    const accepted = vi.fn(), dispose = vi.fn()
    const off = registerSubmissionExtras(SESSION, {
      needsFirstSend: () => true,
      firstSendPrefix: async () => ({ text: '上下文', signal: controller.signal, target: { sessionId: 'fresh', input: target.input, activate: () => switchSideChatSession(previous, 'fresh', 12), dispose } }),
      onAccepted: accepted, onSubmitText: () => {},
    })
    try {
      const sending = submitControlledInput(ctx, source.store, source.reflow, SESSION)
      await flushMicrotasks()
      expect(target.texts).toHaveLength(1)
      expect(readSideChatMeta('parent', 'tab')?.childId).toBe('fresh')
      controller.abort()
      target.acknowledge()
      expect(await sending).toBe(true)
      expect(source.draft()).toBe('')
      expect(accepted).toHaveBeenCalledOnce()
      expect(dispose).toHaveBeenCalledOnce()
    } finally { off() }
  })

  it.each(['edit', 'failure', 'success'] as const)('preserves first-send context during asynchronous preparation: %s', async outcome => {
    harness = makeHarness({ draft: '原始问题', withAnnotation: false })
    let resolve!: (text: string) => void, reject!: (error: Error) => void
    const ready = new Promise<string>((yes, no) => { resolve = yes; reject = no })
    const accepted = vi.fn()
    const off = registerSubmissionExtras(SESSION, { needsFirstSend: () => true, firstSendPrefix: () => ready.then(text => ({ text })), onAccepted: accepted, onSubmitText: () => {} })
    try {
      harness.send(); harness.send()
      expect(harness.submitted).toEqual([])
      if (outcome === 'edit') harness.type('修改')
      if (outcome === 'failure') reject(new Error('page failed'))
      else resolve('<mainline-progress-snapshot>完整上下文</mainline-progress-snapshot>')
      await flushMicrotasks()
      if (outcome === 'success') {
        expect(harness.submitted).toHaveLength(1)
        expect(harness.texts[0]).toMatch(/完整上下文.*原始问题/s)
        expect(accepted).toHaveBeenCalledOnce()
      } else {
        expect(harness.submitted).toHaveLength(0)
        expect(harness.draft()).toBe(outcome === 'edit' ? '原始问题修改' : '原始问题')
        expect(harness.error()).toBeTruthy()
        expect(accepted).not.toHaveBeenCalled()
      }
    } finally { off() }
  })

  it.each([false, true])('moves a plain first send once and retains the target draft on rejection=%s', async rejected => {
    const source = makeHarness({ draft: 'first side question', withAnnotation: false })
    const target = makeHarness({ withAnnotation: false, rejectFirstSend: rejected })
    const ctx = {
      ...source.ctx,
      sessions: { ...source.ctx.sessions,
        scope: (id: string) => ({ sessionId: id }),
        binding: (id: string) => (id === SESSION ? source : target).ctx.sessions.binding(id),
      },
      get: (name: string) => name === 'conversation' ? { input: { for: (scope: { sessionId: string }) => (scope.sessionId === SESSION ? source : target).input } } : undefined,
    } as unknown as Context
    const activate = vi.fn(), dispose = vi.fn(), accepted = vi.fn()
    const off = registerSubmissionExtras(SESSION, {
      needsFirstSend: () => true,
      firstSendPrefix: async () => ({ text: '<mainline-progress-snapshot>tail</mainline-progress-snapshot>', target: { sessionId: 'fresh', input: target.input, activate, dispose } }),
      onAccepted: accepted, onSubmitText: () => {},
    })
    try {
      expect(await submitControlledInput(ctx, source.store, source.reflow, SESSION)).toBe(!rejected)
      expect(activate).toHaveBeenCalledOnce()
      expect(dispose).toHaveBeenCalledOnce()
      expect(source.texts).toEqual([])
      expect(source.draft()).toBe('')
      expect(target.texts).toHaveLength(1)
      expect(target.texts[0]).toContain('first side question')
      expect(target.draft()).toBe(rejected ? 'first side question' : '')
      expect(accepted).toHaveBeenCalledTimes(rejected ? 0 : 1)
      expect(source.store.getSubmission('fresh').pending).toBe(false)
      expect(source.store.getSubmission('fresh').error).toBe(rejected ? 'host rejected this send' : undefined)
    } finally { off() }
  })

  it('preserves the host-selected steer mode for context-only sends and ignores a repeated submit', async () => {
    harness = makeHarness({ draft: '' })
    harness.send('steer')
    harness.send('steer')
    await flushMicrotasks()
    expect(harness.submitted).toEqual(['steer'])
    expect(harness.drafts[0]).toContain('<reference type="annotation" index="1" source="main-chat">')
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
    expect(harness.texts[0]).toContain('<answer>结论</answer>')
    expect(harness.texts[0]).toContain('<quote>原文片段</quote>')
    expect(harness.texts[0]).toMatch(/继续处理正文$/)
    expect(harness.texts[0]!.match(/<reference type="reflow" /g)).toHaveLength(1)
    expect(harness.texts[0]!.match(/<sidenote-context /g)).toHaveLength(1)
    expect(harness.removedReflow).toEqual([1])
    expect(harness.activeAnnotations()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends context-only reflows through the same native admission', async () => {
    harness = makeHarness({ withAnnotation: false, reflowItems: [{ id: 1, text: '结论', sideTitle: '侧边' }] })
    harness.send('steer')
    await flushMicrotasks()
    expect(harness.submitted).toEqual(['steer'])
    expect(harness.texts[0]).toContain('<answer>结论</answer>')
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
    expect(harness.texts[1]!.match(/<reference type="reflow" /g)).toHaveLength(2)
  })
})
