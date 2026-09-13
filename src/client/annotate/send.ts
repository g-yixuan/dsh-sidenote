/**
 * 发送拦截器 v2（Delivery_02 Workitem_01 的核心；v2 经 C2 对抗性审查重写）：
 * 注释/回流对象不进 composer 草稿；有 active 内容时，在「最终提交」瞬间
 * （主 composer 的 Enter / 发送按钮点击）把协议前缀拼到正文前，然后调
 * **宿主输入机原生 `input.submit('queue')`** 完成真实发送。
 *
 * 为什么不点 DOM 按钮（C2 P0 教训）：宿主运行中主按钮变身「停止」、
 * goal bar 的「清除目标」按钮排在 seat 末位——DOM 序识别必然误点。
 * 机器 submit 与宿主 Enter 同路（adjudication/sink/commitSend），
 * running 时自动入队，idle 时直发，对按钮布局零假设。
 *
 * 守卫（全部先检后吞，任一不满足即放行宿主原行为）：
 * - 斜杠命令草稿跳过（dsh-annotation issue#20）；
 * - Cmd/Ctrl+Enter（steer 手势）归还宿主；
 * - 机器相位非 plain（trigger 弹窗/命令菜单/提交事务中）不拦（C2 P1-1）；
 * - seat 内存在打开的 listbox/展开菜单时不拦。
 *
 * 确认与回滚（C2 P1-2）：以 input.state 订阅为唯一确认面——相位回到
 * plain 且草稿清空 = 发出（markSent 只翻当时拼进去的那批 id，C2 P1-3）；
 * 回到 plain 而草稿未清 = 发送失败（宿主 notice + 留稿）→ 仅在草稿仍以
 * 我们拼的前缀开头时剥离回滚（C2 P2-3）；相位未到终态前绝不回滚。
 *
 * 空草稿补位：宿主主按钮在 `draft.trim()==="" && attachments.length===0` 时
 * 被置为原生 `disabled`（dsh-client-ui-conversation 的 `empty`），而注释/回流
 * 按设计不进草稿 —— 于是此时**没有任何可达的发送手势**：浏览器不为 disabled
 * 的按钮派发 `click`（`mousedown` 同样不发），只有 `pointerdown` 仍会到达它
 * （Chromium / Firefox / WebKit 实测一致）。因此对「空草稿导致 disabled 的
 * 主按钮」补一条 pointerdown 拦截；enabled 时一切照旧走 click，两条路径以
 * `button.disabled` 互斥，不会双驱动。**该手势尾随的 click 必须一并吞掉**：
 * 提交瞬间草稿变空，宿主主按钮随即按 `primaryStops = running && empty` 变身
 * 「停止」，放行那一发 click 会立刻 `stop()` 掉刚发起的这一轮 —— 症状是
 * `assistant/attempt` 空流、缺 `turn/end`、界面上却没有任何错误提示。
 */
import type { Context, ConversationService, SessionId, SessionInput } from '../host/contracts.ts'
import { buildProtocolBlock } from './format.ts'
import type { AnnotationStore } from './model.ts'
import { buildReflowBlock, type ReflowStore } from '../reflow.ts'

/** Resolve the per-session input facade, degrading to undefined (never throws). */
export function resolveInput(ctx: Context, sessionId: SessionId): SessionInput | undefined {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return undefined
    const conversation = ctx.get('conversation') as ConversationService | undefined
    return conversation?.input.for(actx)
  } catch {
    return undefined
  }
}

/** 主 composer 的宿主容器（侧边面板 textarea 不在其中，天然不串）。 */
function composerSeat(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-seat]')
}

/** 发送按钮 = [data-composer-card] 内 DOM 序最后一个 button（仅 click 路径用，
 *  且只在非运行态作为识别面——运行态主按钮变身「停止」，整个 click 路径不拦）。 */
function findSendButtonInCard(): HTMLButtonElement | null {
  const card = document.querySelector<HTMLElement>('[data-composer-card]')
  if (card === null) return null
  const buttons = card.querySelectorAll('button')
  const last = buttons[buttons.length - 1]
  return last instanceof HTMLButtonElement ? last : null
}

export function installSendInterceptor(ctx: Context, store: AnnotationStore, reflow: ReflowStore): () => void {
  /** 重入/连按护栏：事务进行中吞掉命中识别面的 Enter/点击（不重复驱动）。 */
  let committing = false

  /**
   * 手势尾随 click 的一次性吞并。pointerdown 提交后，同一次点击的 click 仍会
   * 到达，而此时宿主主按钮已按 `primaryStops = running && empty` 变身「停止」
   * ——放行它会立刻 `stop()` 掉刚发起的这一轮（表现：assistant/attempt 空流、
   * 缺 turn/end、且没有任何错误提示）。只吞这一发，并带兜底超时。
   */
  let swallowNextClick = false
  let swallowTimer = 0
  const clearSwallow = (): void => {
    swallowNextClick = false
    window.clearTimeout(swallowTimer)
  }
  const armSwallow = (): void => {
    swallowNextClick = true
    window.clearTimeout(swallowTimer)
    // 兜底：手势没有产生 click（指针移出按钮等）时不至于吞掉后续无关点击。
    swallowTimer = window.setTimeout(clearSwallow, 2_000)
  }

  const currentSessionId = (): string => {
    try {
      return ctx.sessions.list.getSnapshot().current ?? ''
    } catch {
      return ''
    }
  }

  const hijack = (): boolean => {
    const sessionId = currentSessionId()
    if (sessionId === '') return false
    const active = store.listActive(sessionId)
    const reflows = reflow.list(sessionId)
    if (active.length === 0 && reflows.length === 0) return false
    const input = resolveInput(ctx, sessionId)
    if (input === undefined) return false
    const snap = input.state.getSnapshot()
    const draft = snap.draft
    if (draft.trimStart().startsWith('/')) return false
    // 机器相位守卫：claimed/adjudicating/submitting = 弹窗/命令/事务在走。
    if (snap.phase !== 'plain') return false
    // 弹窗 DOM 守卫：@引用 listbox、「+」菜单展开等。
    const seat = composerSeat()
    if (seat === null) return false
    if (seat.querySelector('[role="listbox"]') !== null) return false
    if (seat.querySelector('[aria-expanded="true"]') !== null) return false

    // 拼稿：回流上下文（背景） → 注释协议块（具体锚点） → 用户正文。
    const parts: string[] = []
    for (const item of reflows) parts.push(buildReflowBlock(item))
    if (active.length > 0) parts.push(buildProtocolBlock(active))
    const body = draft.trim()
    const full = [...parts, ...(body === '' ? [] : [body])].join('\n\n')
    const sentIds = active.map(a => a.id)

    input.setDraft(full)
    committing = true
    try {
      input.submit('queue')
    } catch (error) {
      // 提交抛错：精确剥离前缀回滚，内容保持 active。
      console.warn('[dsh-sidenote] 提交失败，回滚草稿:', error)
      const now = input.state.getSnapshot().draft
      if (now.startsWith(full)) input.setDraft(draft)
      committing = false
      return true
    }

    // 确认面：订阅机器相位。回到 plain 后看草稿判定成败。
    const off = input.state.subscribe(() => {
      const state = input.state.getSnapshot()
      if (state.phase !== 'plain') return
      window.clearTimeout(watchdog)
      off()
      committing = false
      if (state.draft.trim() === '') {
        // 成功：只翻转当时拼进去的那批注释（窗口内新增的不动）。
        store.markSent(sentIds)
        reflow.clearSession(sessionId)
        return
      }
      // 失败（宿主 notice + 留稿）：草稿仍以我们拼的前缀开头才剥离。
      const stuck = state.draft
      if (stuck.startsWith(full)) input.setDraft(draft)
    })
    // 看门狗：相位永远不回 plain（宿主异常）→ 解锁护栏，不动草稿（保守）。
    const watchdog = window.setTimeout(() => {
      off()
      committing = false
    }, 15_000)
    return true
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    // 0.1.2 兼容（W00-send-intercept-012）：宿主 composer 从受控 <textarea>
    // 重写为 Lexical contenteditable（div[data-composer-input]，Enter 走
    // Lexical command 层）。识别面双兼容：新锚点 closest 优先，旧 textarea
    // 回退；锚点 closest 天然覆盖内层 chip span/文本节点。
    const inSeat = target instanceof HTMLElement
      && (target.closest('[data-composer-input]') !== null || target instanceof HTMLTextAreaElement)
      && target.closest('[data-composer-seat]') !== null
    if (!inSeat) return
    if (committing) {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.metaKey || event.ctrlKey) return // steer 手势归还宿主
    if (event.isComposing || event.keyCode === 229) return
    if (!hijack()) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const seat = target.closest('[data-composer-seat]')
    if (seat === null) return
    // 尾随 click：必须先于按钮识别吞掉（见 armSwallow），否则宿主按「停止」处理。
    if (swallowNextClick) {
      clearSwallow()
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const button = target.closest('button')
    if (button === null) return
    if (committing) {
      // 事务进行中：吞掉 seat 内一切按钮点击（防双驱动）。
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    // 识别面收窄到卡片内末位按钮（goal bar 在 card 外、不构成误点）；
    // 运行态主按钮是「停止」——相位守卫已在 hijack 内（plain 才拦）。
    if (button !== findSendButtonInCard()) return
    if (!hijack()) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  /**
   * 空草稿补位：只接管「因空草稿而 disabled」的主按钮。enabled 时立即放行，
   * 正常路径仍由上面的 click 拦截负责 —— 二者以 button.disabled 互斥。
   */
  const onPointerDown = (event: PointerEvent): void => {
    // 只认主键：右键/中键的 pointerdown 同样到达 disabled 按钮（已实证），
    // 不检查会把「打开上下文菜单」误当发送手势。
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (!(button instanceof HTMLButtonElement)) return
    if (!button.disabled) return
    if (button !== findSendButtonInCard()) return
    if (committing) return
    // disabled 的成因必须是空草稿：离线/无模型等其它成因不属本拦截器授权范围。
    const sessionId = currentSessionId()
    if (sessionId === '') return
    const input = resolveInput(ctx, sessionId)
    if (input === undefined || input.state.getSnapshot().draft.trim() !== '') return
    if (!hijack()) return
    // 同一次手势的 click 紧随其后，而主按钮此刻已变身「停止」——吞掉这一发。
    armSwallow()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
  }
}
