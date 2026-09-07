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
    const inSeat = target instanceof HTMLTextAreaElement && target.closest('[data-composer-seat]') !== null
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

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('click', onClick, true)
  }
}
