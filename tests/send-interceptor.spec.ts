/**
 * @vitest-environment jsdom
 *
 * 空草稿补位（send.ts 的 pointerdown 分支）回归测。
 *
 * 背景：宿主主按钮在 `draft.trim()==="" && attachments.length===0` 时是原生
 * `disabled`，而注释/回流按设计不进草稿 —— 这类按钮上浏览器不派发 `click`
 * （`mousedown` 同样不发），只有 `pointerdown` 能到（Chromium / Firefox /
 * WebKit 实测一致）。本测锁住拦截器的判定边界：只接管「因空草稿而 disabled
 * 的主按钮」，其余一切情况放行宿主。
 *
 * 注意：jsdom 的 dispatchEvent 不模拟浏览器对 disabled 控件的 click 抑制，
 * 因此这里验证的是**拦截器逻辑**，不是浏览器的投递行为。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Context, SessionInput } from '../src/client/host/contracts.ts'
import type { ReflowStore } from '../src/client/reflow.ts'
import { createAnnotationStore } from '../src/client/annotate/model.ts'
import { installSendInterceptor } from '../src/client/annotate/send.ts'

const SESSION = 's1'

interface Harness {
  dispose: () => void
  submitted: string[]
  drafts: string[]
  removeAllAnnotations: () => void
}

/**
 * 复刻宿主 composer 的最小识别面：`[data-composer-seat]` › `[data-composer-card]`
 * 内两个按钮（`#extra` 常 disabled，`#send` 是 DOM 末位 = 主按钮）。
 */
function makeHarness(options: { draft?: string; buttonDisabled?: boolean } = {}): Harness {
  const sendDisabled = options.buttonDisabled ?? true
  document.body.innerHTML = `
    <div data-composer-seat>
      <div data-composer-card>
        <button type="button" id="extra" disabled>attach</button>
        <button type="button" id="send"${sendDisabled ? ' disabled' : ''}>send</button>
      </div>
    </div>`

  const state = { draft: options.draft ?? '', phase: 'plain' as const }
  const submitted: string[] = []
  const drafts: string[] = []

  const input = {
    state: {
      getSnapshot: () => state,
      subscribe: () => () => {},
    },
    setDraft: (text: string) => { drafts.push(text); state.draft = text },
    submit: (mode?: string) => { submitted.push(mode ?? '') },
    notify: () => {},
  } as unknown as SessionInput

  const ctx = {
    sessions: {
      scope: () => ({}),
      list: { getSnapshot: () => ({ current: SESSION }) },
    },
    get: (name: string) => (name === 'conversation' ? { input: { for: () => input } } : undefined),
  } as unknown as Context

  const reflow: ReflowStore = {
    getSnapshot: () => 0,
    subscribe: () => () => {},
    add: () => { throw new Error('unused in this spec') },
    remove: () => {},
    clearSession: () => {},
    list: () => [],
  }

  const store = createAnnotationStore()
  store.add({ sessionId: SESSION, anchorKey: 'k1', text: '原文片段', anchorText: '原文片段', occurrence: 0, note: '' })

  return {
    dispose: installSendInterceptor(ctx, store, reflow),
    submitted,
    drafts,
    removeAllAnnotations: () => { for (const a of store.listActive(SESSION)) store.remove(a.id) },
  }
}

function pointerDown(element: Element): Event {
  const Ctor = (globalThis as unknown as { PointerEvent?: typeof Event }).PointerEvent ?? Event
  const event = new Ctor('pointerdown', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

describe('send interceptor — 空草稿补位（disabled 主按钮）', () => {
  let harness: Harness | undefined

  afterEach(() => {
    harness?.dispose()
    harness = undefined
    document.body.innerHTML = ''
  })

  it('接管因空草稿而 disabled 的主按钮：拼入协议块后提交', () => {
    harness = makeHarness({ draft: '', buttonDisabled: true })
    const event = pointerDown(document.querySelector('#send')!)
    expect(harness.submitted).toEqual(['queue'])
    expect(harness.drafts).toHaveLength(1)
    expect(harness.drafts[0]).toContain('I annotated 1 passage(s) of the conversation above:')
    expect(event.defaultPrevented).toBe(true)
  })

  it('enabled 的主按钮一律放行（正常路径仍由 click 拦截负责，不双驱动）', () => {
    harness = makeHarness({ draft: '正文', buttonDisabled: false })
    const event = pointerDown(document.querySelector('#send')!)
    expect(harness.submitted).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('disabled 但草稿非空（离线/无模型等其它成因）不接管', () => {
    harness = makeHarness({ draft: '正文', buttonDisabled: true })
    pointerDown(document.querySelector('#send')!)
    expect(harness.submitted).toEqual([])
  })

  it('disabled 的非主按钮不接管（DOM 序识别面收窄到卡片内末位按钮）', () => {
    harness = makeHarness({ draft: '', buttonDisabled: true })
    pointerDown(document.querySelector('#extra')!)
    expect(harness.submitted).toEqual([])
  })

  it('没有待发内容时不接管：死按钮保持死的，不产生空提交', () => {
    harness = makeHarness({ draft: '', buttonDisabled: true })
    harness.removeAllAnnotations()
    pointerDown(document.querySelector('#send')!)
    expect(harness.submitted).toEqual([])
  })

  it('dispose 后监听器全部摘除', () => {
    harness = makeHarness({ draft: '', buttonDisabled: true })
    harness.dispose()
    pointerDown(document.querySelector('#send')!)
    expect(harness.submitted).toEqual([])
  })
})
