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
  drafts: string[]
  removeAllAnnotations: () => void
  /** 模拟用户输入（inject 等待窗口内的编辑）。 */
  type: (text: string) => void
  draft: () => string
  removedReflow: number[]
}

function makeHarness(options: { draft?: string; withAnnotation?: boolean; rejectFirstSend?: boolean; reflowItems?: { id: number; text: string; sideTitle: string }[] } = {}): Harness {

  const state = { draft: options.draft ?? '', phase: 'plain' as const }
  const submitted: string[] = []
  const drafts: string[] = []
  const sessionState = { sessionId: SESSION, running: false, nodes: [] as unknown[], promptError: undefined as { op: string, error: { message: string } } | undefined }
  let rejectNextSend = options.rejectFirstSend ?? false
  const sessionListeners = new Set<() => void>()
  const session = {
    getSnapshot: () => sessionState,
    subscribe: (fn: () => void) => { sessionListeners.add(fn); return () => { sessionListeners.delete(fn) } },
  }

  const input = {
    state: {
      getSnapshot: () => state,
      subscribe: () => () => {},
    },
    setDraft: (text: string) => { drafts.push(text); state.draft = text },
    submit: (mode?: string) => {
      submitted.push(mode ?? 'queue')
      if (rejectNextSend) {
        rejectNextSend = false
        sessionState.promptError = { op: 'send', error: { message: 'host rejected this send' } }
        for (const fn of sessionListeners) fn()
        return
      }
      sessionState.promptError = undefined
      sessionState.nodes.push({ kind: 'user', seq: sessionState.nodes.length + 1, content: [{ type: 'text', text: state.draft }] })
      state.draft = ''
      for (const fn of sessionListeners) fn()
    },
    notify: () => {},
  } as unknown as SessionInput

  const ctx = {
    sessions: {
      scope: () => ({}),
      binding: () => ({ session }),
      list: { getSnapshot: () => ({ current: SESSION }) },
    },
    get: (name: string) => (name === 'conversation' ? { input: { for: () => input } } : undefined),
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
    drafts,
    removeAllAnnotations: () => { for (const a of store.listActive(SESSION)) store.remove(a.id) },
    type: (text: string) => { state.draft += text },
    draft: () => state.draft,
    removedReflow: removed,
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

  it('纯回流+空草稿+注入成功：不发消息、不吞后续输入（B-1 回归）', async () => {
    harness = makeHarness({ draft: '', withAnnotation: false, reflowItems: [{ id: 1, text: '结论', sideTitle: '侧边' }] })
    // fetch 成功（注入通道可用）
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    harness.send()
    await flushMicrotasks()
    // 注入成功 → 拼稿为空 → 不开事务（submit 不被调）
    expect(harness.submitted).toEqual([])
    expect(harness.removedReflow).toEqual([1])
    // 用户随后输入不被吞（护栏已解锁，草稿保持）
    harness.type('后续输入')
    expect(harness.draft()).toBe('后续输入')
  })

  it('注入等待窗口内的用户输入不被回滚吃掉（M-1 回归）', async () => {
    harness = makeHarness({ draft: '正文' })
    // fetch 挂起（模拟慢注入）→ 窗口内输入 → 注入失败 → 搭车拼稿应含窗口内输入
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      () => new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('timeout')), 400) }),
    ))
    harness.send()
    harness.type('（窗口内补充）')
    await flushMicrotasks()
    await new Promise(resolve => setTimeout(resolve, 450))
    await flushMicrotasks()
    expect(harness.submitted).toEqual(['queue'])
    expect(harness.drafts[0]).toContain('（窗口内补充）')
  })

  it('回流全部成功注入时仍通过原生机器发送已有正文', async () => {
    harness = makeHarness({ draft: '继续处理正文', withAnnotation: false, reflowItems: [{ id: 1, text: '结论', sideTitle: '侧边' }] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    harness.send()
    await flushMicrotasks()
    expect(harness.removedReflow).toEqual([1])
    expect(harness.submitted).toEqual(['queue'])
    expect(harness.drafts).toEqual([])
    expect(harness.draft()).toBe('')
  })

  it('部分注入后正文发送拒绝：保留未投递结论和干净草稿，重试只投递剩余项', async () => {
    harness = makeHarness({ draft: '保留正文', withAnnotation: false, rejectFirstSend: true, reflowItems: [{ id: 1, text: '已注入结论', sideTitle: '侧边' }, { id: 2, text: '待重试结论', sideTitle: '侧边' }] })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, injectedIndexes: [0] }), { status: 200 }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: false, injectedIndexes: [] }), { status: 200 }))))
    harness.send()
    await flushMicrotasks()
    expect(harness.removedReflow).toEqual([1])
    expect(harness.draft()).toBe('保留正文')
    expect(harness.drafts.some(text => text.includes('待重试结论'))).toBe(true)
    expect(harness.drafts.some(text => text.includes('已注入结论'))).toBe(false)

    harness.send()
    await flushMicrotasks()
    expect(harness.removedReflow).toEqual([1, 2])
    expect(harness.submitted).toEqual(['queue', 'queue'])
    expect(harness.draft()).toBe('')
    const retry = JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string)
    expect(retry.items).toHaveLength(1)
    expect(retry.items[0].text).toContain('待重试结论')
  })
})
