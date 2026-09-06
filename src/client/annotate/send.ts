/**
 * 发送拦截器（Delivery_02 Workitem_01 的核心）：注释对象从此不进 composer
 * 草稿；有 active 注释时，在「最终提交」瞬间（主 composer 的 Enter / 发送
 * 按钮）把协议块拼到用户正文前，再驱动宿主完成真实发送。
 *
 * 宿主没有 send-transform 钩子，本模块采用 dsh-annotation 验证过的
 * capture 拦截（其 issue#20/#23 的教训已吸收：斜杠命令跳过、发送按钮
 * 路径同样覆盖、IME 守卫）。
 *
 * 识别面（宿主 DOM，非公开契约——全部 feature-check，识别失败即不拦截，
 * 注释留在 active 等下次，绝不丢）：
 * - 主 composer：document 里的 [data-composer-seat]（侧边聊天面板的
 *   textarea 不在其中，天然不串）；
 * - 发送按钮：seat 内 DOM 序最后一个 <button>（宿主 InputBar 尾部行
 *   最末是主按钮，运行中「停止」按钮在其前；aria-label 是宿主本地化
 *   文案，不作为识别依据）。
 *
 * 状态一致性：拼稿后先等按钮就绪 → click 驱动宿主 → 以「草稿被清空」为
 * 提交确认（队列路径同样清空草稿）；确认才 markSessionSent，超时则精确
 * 回滚草稿、注释保持 active——任何失败路径都不留半成品。
 */
import type { Context, ConversationService, SessionId, SessionInput } from '../../context-types.ts'
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

/** 主 composer 的宿主容器。 */
function composerSeat(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-seat]')
}

/** 发送按钮 = seat 内 DOM 序最后一个 button（无 seat/无按钮 → null，不拦截）。 */
function findSendButton(seat: HTMLElement): HTMLButtonElement | null {
  const buttons = seat.querySelectorAll('button')
  const last = buttons[buttons.length - 1]
  return last instanceof HTMLButtonElement ? last : null
}

export function installSendInterceptor(ctx: Context, store: AnnotationStore, reflow: ReflowStore): () => void {
  /** 重入护栏：我们程序化 click 发送按钮会再次路过 click 监听。 */
  let committing = false

  const currentSessionId = (): string => {
    try {
      return ctx.sessions.list.getSnapshot().current ?? ''
    } catch {
      return ''
    }
  }

  /**
   * 尝试接管一次提交。返回 true = 已接管（事件已吞、发送由我们驱动）；
   * 返回 false = 放行（无注释/斜杠命令/识别面缺失），宿主行为原样。
   */
  const hijack = (): boolean => {
    const sessionId = currentSessionId()
    if (sessionId === '') return false
    const active = store.listActive(sessionId)
    const reflows = reflow.list(sessionId)
    if (active.length === 0 && reflows.length === 0) return false
    const input = resolveInput(ctx, sessionId)
    if (input === undefined) return false
    const draft = input.state.getSnapshot().draft
    // 斜杠命令/技能触发不拼协议块（dsh-annotation issue#20）。
    if (draft.trimStart().startsWith('/')) return false
    const seat = composerSeat()
    if (seat === null) return false
    const sendButton = findSendButton(seat)
    if (sendButton === null) return false

    // 消息组装序：回流上下文（背景） → 注释协议块（具体锚点） → 用户正文。
    const parts: string[] = []
    for (const item of reflows) parts.push(buildReflowBlock(item))
    if (active.length > 0) parts.push(buildProtocolBlock(active))
    const body = draft.trim()
    const full = [...parts, ...(body === '' ? [] : [body])].join('\n\n')
    input.setDraft(full)
    committing = true

    // 草稿经 React 状态异步生效 → 等按钮就绪后点击 → 以草稿清空为提交确认。
    const startedAt = Date.now()
    const attempt = (): void => {
      // 宿主结构中途消失（路由切换等）：回滚，下轮用户操作重试。
      if (!sendButton.isConnected) {
        input.setDraft(draft)
        committing = false
        return
      }
      if (sendButton.disabled) {
        if (Date.now() - startedAt < 1000) window.setTimeout(attempt, 50)
        else {
          input.setDraft(draft)
          committing = false
        }
        return
      }
      sendButton.click()
      // 提交确认窗口：草稿被宿主清空（提交/入队都会）才算真正发出。
      const confirm = (): void => {
        const nowDraft = input.state.getSnapshot().draft
        if (nowDraft.trim() === '') {
          store.markSessionSent(sessionId)
          reflow.clearSession(sessionId)
          committing = false
          return
        }
        if (Date.now() - startedAt < 1500) {
          window.setTimeout(confirm, 50)
          return
        }
        // 发送未发生（宿主拒绝/失败回填）：精确回滚到我们拼稿前的正文。
        input.setDraft(draft)
        committing = false
      }
      confirm()
    }
    attempt()
    return true
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (committing) return
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.isComposing || event.keyCode === 229) return
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement)) return
    if (target.closest('[data-composer-seat]') === null) return
    if (!hijack()) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: MouseEvent): void => {
    if (committing) return
    const target = event.target
    if (!(target instanceof Element)) return
    const seat = target.closest('[data-composer-seat]')
    if (seat === null) return
    const button = target.closest('button')
    if (button === null || button !== findSendButton(seat as HTMLElement)) return
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
