/**
 * 侧边聊天 Tab 面板：fork 编排（首开）/ 绑定恢复（刷新后）/ 消息流 / composer。
 *
 * 打开流程（design.md 详细方案 2）：组件挂载时 tab.meta 无 childId →
 * ctx.sessions.fork({ sessionId: scope.sessionId })（fork 时刻全量历史快照）
 * → ctx.workspaces.archiveSession(childId)（durable 隐藏出会话列表）
 * → ctx.betterSidebar.updateTab(tab.id, { meta: { childId, parentSessionId } })
 * （Tab meta 即注册表，随布局持久化，刷新/重启后恢复）。
 * fork 失败（blank 会话无已完成 turn 等）→ 中文错误态 + 关闭指引，不崩页面。
 *
 * 恢复流程：有 meta.childId → ctx.sessions.binding(childId) 直接绑定；
 * 列表就绪后仍不在列 → 「会话已不存在」态。
 *
 * 消息流：binding.session 快照订阅（useSyncExternalStore），visible=false 时
 * 暂停订阅。已知偏差（记录于此）：client-runtime 只为 staged（当前选中）会话
 * 打开事件窗口，非 staged 会话 openState 停留 'cold' 且 acceptLiveEvent 丢弃
 * 事件 —— 因此绑定后对该会话调一次 concrete Session 的 open()（off-face、
 * feature-check、幂等），否则消息流永远为空。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconNewChatOutline16, IconSendOutline16, IconStopFill16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SessionFace, TabComponentProps } from '../../context-types.ts'
import { useComposer, type Composer } from './composer.ts'
import { clearPendingDraft, parseSideChatMeta, phaseOf, transcriptOf, type ChatMessage } from './model.ts'
import { readTab } from './open.ts'
import css from './sidechat.module.css'

/** MarkdownText 代码块复制按钮文案（契约要求中文；引用稳定，变了会清流式缓存）。 */
const CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' } as const

const NOOP_UNSUBSCRIBE = (): void => {}

/**
 * 打开非 staged 会话的事件窗口（off-face：open() 在 concrete Session 上是
 * public 且幂等，但不在 SessionFace 契约上 —— 契约面只有 staged 会话会被
 * 运行时自动 open）。feature-check + 吞错，运行时若移除则降级为只发不收。
 */
function openSessionWindow(session: SessionFace | undefined): void {
  const openable = session as unknown as { open?: () => Promise<void> } | undefined
  if (typeof openable?.open !== 'function') return
  openable.open().catch((error: unknown) => {
    console.warn('[dsh-side-chat] 会话窗口打开失败:', error)
  })
}

export function SideChatPanel(props: TabComponentProps) {
  const { ctx, scope, tab, visible } = props
  const meta = parseSideChatMeta(tab.meta)
  const childId = meta.childId
  const [forkError, setForkError] = useState<string | null>(null)
  const forkStarted = useRef(false)

  // ── 首开：fork → archive → 登记 meta（注册表写进布局，随其持久化） ──
  useEffect(() => {
    if (childId !== undefined || forkStarted.current) return
    forkStarted.current = true
    let cancelled = false
    void (async () => {
      try {
        const forked = await ctx.sessions.fork({ sessionId: scope.sessionId })
        // 隐藏出会话列表（durable KV，刷新/重启后仍生效）。归档失败不阻断
        // 面板（会话已 fork 出来），只告警 —— 无 unarchive API，失败残留可见。
        try {
          await ctx.workspaces.archiveSession(forked)
        } catch (error) {
          console.warn('[dsh-side-chat] 归档侧边会话失败（会话列表可能短暂可见）:', error)
        }
        if (cancelled) return
        // 合并写入：桥接可能已先写入 pendingDraft，不能覆盖丢草稿。
        const current = parseSideChatMeta(readTab(ctx, tab.id)?.meta)
        ctx.betterSidebar.updateTab(tab.id, {
          meta: { ...current, childId: forked, parentSessionId: scope.sessionId },
        })
      } catch (error) {
        if (!cancelled) setForkError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => { cancelled = true }
  }, [ctx, scope.sessionId, tab.id, childId])

  // ── 列表订阅：phase（就绪与否）+ byId（在列与否）驱动「会话已不存在」判定 ──
  const listSnap = useSyncExternalStore(
    (notify: () => void) => ctx.sessions.list.subscribe(notify),
    () => ctx.sessions.list.getSnapshot(),
  )
  const listed = childId !== undefined && listSnap.byId?.[childId] !== undefined
  const binding = childId === undefined ? undefined : ctx.sessions.binding(childId)
  const session = binding?.session

  // 绑定即开窗口（幂等）：拉历史尾页 + 开始接收实时事件。
  useEffect(() => {
    openSessionWindow(session)
  }, [session])

  const phase = phaseOf({
    childId,
    forkError,
    bound: session !== undefined,
    listPhase: listSnap.phase,
    listed,
  })

  // ── 消息流订阅：visible=false 时暂停（订阅身份随 visible 变化即断开） ──
  const snapshot = useSyncExternalStore(
    useCallback(
      (notify: () => void) => (visible && session !== undefined ? session.subscribe(notify) : NOOP_UNSUBSCRIBE),
      [visible, session],
    ),
    () => (session === undefined ? null : session.getSnapshot()),
  )
  const messages = useMemo(() => transcriptOf(snapshot), [snapshot])

  // ── composer（input 机器优先，降级本地草稿 + session.prompt） ──
  const composer = useComposer(ctx, session, childId)

  // ── 桥接草稿移交：meta.pendingDraft → composer 草稿，应用后清除 ──
  const pendingDraft = meta.pendingDraft
  useEffect(() => {
    if (pendingDraft === undefined || pendingDraft === '' || phase !== 'chat') return
    composer.appendDraft(pendingDraft)
    const current = parseSideChatMeta(readTab(ctx, tab.id)?.meta)
    ctx.betterSidebar.updateTab(tab.id, { meta: clearPendingDraft(current) })
    // appendDraft 随草稿逐键换身份；不列入依赖 —— effect 只在
    // pendingDraft/相位变化时真正动作（清除后 pendingDraft 为 undefined，幂等）。
  }, [pendingDraft, phase, ctx, tab.id])

  // 新消息到底自动滚动（窄栏面板，不做「接近底部才跟」的判定）。
  const bodyRef = useRef<HTMLDivElement>(null)
  const tailKey = messages.length === 0 ? '' : `${messages[messages.length - 1]!.key}:${messages[messages.length - 1]!.text.length}`
  useEffect(() => {
    const el = bodyRef.current
    if (el !== null && visible) el.scrollTop = el.scrollHeight
  }, [tailKey, visible])

  if (phase === 'fork-error') {
    return (
      <StateScreen
        title="无法创建侧边聊天"
        detail={forkError ?? undefined}
        hint="主会话需要至少一轮已完成的对话才能 fork。点击标签上的 × 可关闭此标签页。"
      />
    )
  }
  if (phase === 'missing') {
    return (
      <StateScreen
        title="会话已不存在"
        detail="此侧边聊天的会话已被移除，无法恢复。"
        hint="点击标签上的 × 关闭此标签页。"
      />
    )
  }
  if (phase === 'forking' || phase === 'loading') {
    return <StateScreen title="正在准备侧边聊天…" />
  }

  const running = snapshot?.running === true
  const openFailed = snapshot?.openState === 'error'

  return (
    <div className={css.root}>
      <div ref={bodyRef} className={css.body}>
        {messages.length === 0 && !running
          ? <EmptyState />
          : <MessageList messages={messages} />}
        {openFailed && <div className={css.errorRow}>会话历史加载失败，可关闭后重新打开此标签页。</div>}
      </div>
      <ComposerBar ctx={ctx} session={session} composer={composer} running={running} visible={visible} />
    </div>
  )
}

/** 空状态：💬 类图标 + 标题 + fork 语义文案（形态规格）。 */
function EmptyState() {
  return (
    <div className={css.empty}>
      <div className={css.emptyIcon}><IconNewChatOutline16 size={32} /></div>
      <div className={css.emptyTitle}>侧边聊天</div>
      <div className={css.emptyText}>侧边聊天从当前会话 fork，独立演进；关闭标签页后消失。</div>
    </div>
  )
}

/** 加载 / 错误整屏态（标题 + 可选详情 + 可选指引）。 */
function StateScreen(props: { title: string; detail?: string; hint?: string }) {
  return (
    <div className={css.stateScreen}>
      <div className={css.emptyIcon}><IconNewChatOutline16 size={32} /></div>
      <div className={css.emptyTitle}>{props.title}</div>
      {props.detail !== undefined && props.detail !== '' && <div className={css.stateDetail}>{props.detail}</div>}
      {props.hint !== undefined && props.hint !== '' && <div className={css.emptyText}>{props.hint}</div>}
    </div>
  )
}

function MessageList({ messages }: { messages: readonly ChatMessage[] }) {
  return (
    <div className={css.transcript}>
      {messages.map(message => <MessageRow key={message.key} message={message} />)}
    </div>
  )
}

function MessageRow({ message }: { message: ChatMessage }) {
  switch (message.role) {
    case 'user':
      return (
        <div className={css.userRow}>
          <div className={css.userBubble}>{message.text}</div>
        </div>
      )
    case 'assistant':
      return (
        <div className={css.assistantRow}>
          <div className={css.assistantBody}>
            {message.reasoning !== undefined && message.reasoning !== '' && (
              <details className={css.reasoning}>
                <summary>思考过程</summary>
                <div className={css.reasoningBody}>{message.reasoning}</div>
              </details>
            )}
            {message.text !== ''
              ? <MarkdownText text={message.text} streaming={message.streaming} codeLabels={CODE_LABELS} />
              : message.streaming === true && <div className={css.streamingHint}>正在输出…</div>}
            {message.interrupted === true && <div className={css.noticeRow}>已停止</div>}
          </div>
        </div>
      )
    case 'tool':
      return (
        <div className={css.toolCard}>
          <div className={css.toolHead}>
            工具 · {message.toolName}
            {message.isError === true && <span className={css.toolError}>失败</span>}
            {message.streaming === true && <span className={css.toolRunning}>执行中…</span>}
          </div>
          {message.text !== '' && <div className={css.toolBody}>{message.text}</div>}
        </div>
      )
    case 'error':
      return <div className={css.errorRow}>{message.text}</div>
    case 'notice':
      return <div className={css.noticeRow}>{message.text}</div>
  }
}

/** 底部 composer：自绘输入框；模型固定「跟随主会话」（fork 继承父会话模型选择）。 */
function ComposerBar(props: {
  ctx: Context
  session: SessionFace | undefined
  composer: Composer
  running: boolean
  visible: boolean
}) {
  const { session, composer, running, visible } = props
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 面板可见时预聚焦输入框（sidebar-qa AskPanel 同款）。
  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  return (
    <div className={css.composer}>
      <textarea
        ref={inputRef}
        className={css.input}
        placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
        value={composer.draft}
        onChange={(event) => { composer.setDraft(event.target.value) }}
        onKeyDown={(event) => {
          // IME 保护：组合中（候选窗未提交）的 Enter 属于输入法。
          if (event.key !== 'Enter' || event.shiftKey) return
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          event.preventDefault()
          composer.submit()
        }}
      />
      <div className={css.composerFoot}>
        <span className={css.modelLabel}>模型：跟随主会话</span>
        {running
          ? (
            <button
              type="button"
              className={css.stopButton}
              title="停止当前回复"
              onClick={() => { session?.cancel().catch(() => {}) }}
            >
              <IconStopFill16 size={14} /> 停止
            </button>
          )
          : (
            <button
              type="button"
              className={css.sendButton}
              disabled={composer.draft.trim() === ''}
              onClick={() => { composer.submit() }}
            >
              <IconSendOutline16 size={14} /> 发送
            </button>
          )}
      </div>
      {composer.sendError !== null && <div className={css.errorRow}>{composer.sendError}</div>}
    </div>
  )
}
