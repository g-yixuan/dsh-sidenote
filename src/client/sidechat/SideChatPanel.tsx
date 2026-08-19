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
import { t, useLocaleTick } from '../locales.ts'
import css from './sidechat.module.css'

/** MarkdownText 代码块复制按钮文案（契约要求中文；引用稳定，变了会清流式缓存）。 */
/** MarkdownText 代码块复制按钮文案（跟随 DSH 语言；函数内读取保持引用稳定）。 */
function codeLabels() {
  return { copyLabel: t('codeCopy'), copiedLabel: t('codeCopied') }
}

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
    console.warn('[dsh-sidechat] 会话窗口打开失败:', error)
  })
}

export function SideChatPanel(props: TabComponentProps) {
  useLocaleTick()
  const { ctx, scope, tab, visible } = props
  const meta = parseSideChatMeta(tab.meta)
  const childId = meta.childId
  const [forkError, setForkError] = useState<string | null>(null)
  const forkStarted = useRef(false)

  // 程序化入口（/side、bridge 划选提问）打开 Tab 时面板可能处于折叠态——
  // 类型型 openTab 不自动展开（better-sidebar 只对 path/url 内容型打开展开），
  // 用户会看不见刚开的侧边聊天。面板组件在折叠时也挂载（visible=false），
  // 挂载即幂等展开（store.update 是 SidebarStore 的公开 mutator 面；
  // feature-check + 吞错）。
  const { store } = props
  useEffect(() => {
    const mutable = store as { update?: (mutate: (state: { panelOpen?: boolean }) => void) => void } | undefined
    try {
      mutable?.update?.((state) => {
        if (state.panelOpen === false) state.panelOpen = true
      })
    } catch {
      // 面板折叠兜底失败不影响功能——用户手动展开即可。
    }
  }, [store])

  // ── 首开：fork → archive → 登记 meta（注册表写进布局，随其持久化） ──
  useEffect(() => {
    if (childId !== undefined || forkStarted.current) return
    forkStarted.current = true
    let cancelled = false
    void (async () => {
      try {
        const forked = await ctx.sessions.fork({ sessionId: scope.sessionId })
        // meta 先行：fork resolve 后立即登记 childId（会话切换导致组件卸载
        // 时 updateTab 找不到 tab 也只是 no-op，绝不丢登记——否则该 Tab 永远
        // 停在 forking 且下次挂载会重复 fork 出孤儿会话）。归档与模型同步
        // 都是 best-effort 后手。
        const current = parseSideChatMeta(readTab(ctx, tab.id)?.meta)
        ctx.betterSidebar.updateTab(tab.id, {
          meta: { ...current, childId: forked, parentSessionId: scope.sessionId },
        })
        // 隐藏出会话列表（durable KV，刷新/重启后仍生效）。归档失败不阻断
        // 面板（会话已 fork 出来），只告警 —— 无 unarchive API，失败残留可见。
        try {
          await ctx.workspaces.archiveSession(forked)
        } catch (error) {
          console.warn('[dsh-sidechat] 归档侧边会话失败（会话列表可能短暂可见）:', error)
        }
        // 模型跟随主会话：fork 继承 agent preset 但不继承模型选择——读主会话
        // 当前模型（session.models.current）并 selectModel 到子会话（best-effort，
        // 失败则子会话用宿主默认模型，面板标签如实回退）。
        try {
          const parentModels = await ctx.connection.api.sessions.models({ sessionId: scope.sessionId })
          if (parentModels.result.ok) {
            const current = parentModels.result.value.current
            await ctx.connection.api.sessions.selectModel({
              sessionId: forked,
              provider: current.provider,
              model: current.model,
              ...(current.reasoningEffort !== undefined ? { reasoningEffort: current.reasoningEffort } : {}),
            })
          }
        } catch (error) {
          console.warn('[dsh-sidechat] 同步主会话模型失败（子会话用默认模型）:', error)
        }
      } catch (error) {
        if (!cancelled) setForkError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => { cancelled = true }
  }, [ctx, scope.sessionId, tab.id, childId])

  // ── 列表订阅：phase（就绪与否）+ byId（在列与否）驱动「会话已不存在」判定 ──
  const listSnap = useSyncExternalStore(
    useCallback((notify: () => void) => ctx.sessions.list.subscribe(notify), [ctx]),
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

  // ── 模型标签：读子会话当前模型（fork 时已同步主会话选择；读取失败保持默认文案） ──
  const [modelName, setModelName] = useState<string | null>(null)
  useEffect(() => {
    if (childId === undefined || session === undefined) return
    let cancelled = false
    void ctx.connection.api.sessions.models({ sessionId: childId })
      .then((res) => {
        if (!cancelled && res.result.ok) setModelName(res.result.value.current.model)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [ctx, childId, session])

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
  // tailKey 并入 reasoning 长度：纯思考流式增长（text 为空）也要跟滚。
  const bodyRef = useRef<HTMLDivElement>(null)
  const tailKey = messages.length === 0 ? '' : `${messages[messages.length - 1]!.key}:${messages[messages.length - 1]!.text.length}:${messages[messages.length - 1]!.reasoning?.length ?? 0}`
  useEffect(() => {
    const el = bodyRef.current
    if (el !== null && visible) el.scrollTop = el.scrollHeight
  }, [tailKey, visible])

  if (phase === 'fork-error') {
    return (
      <StateScreen
        title={t('forkErrorTitle')}
        detail={forkError ?? undefined}
        hint={t('forkErrorHint')}
      />
    )
  }
  if (phase === 'missing') {
    return (
      <StateScreen
        title={t('missingTitle')}
        detail={t('missingDetail')}
        hint={t('missingHint')}
      />
    )
  }
  if (phase === 'forking' || phase === 'loading') {
    return <StateScreen title={t('preparing')} />
  }

  const running = snapshot?.running === true
  const openFailed = snapshot?.openState === 'error'

  return (
    <div className={css.root}>
      <div ref={bodyRef} className={css.body}>
        {messages.length === 0 && !running
          ? <EmptyState />
          : <MessageList messages={messages} />}
        {openFailed && <div className={css.errorRow}>{t('historyFailed')}</div>}
      </div>
      <ComposerBar ctx={ctx} session={session} composer={composer} running={running} visible={visible} modelName={modelName} />
    </div>
  )
}

/** 空状态：💬 类图标 + 标题 + fork 语义文案（形态规格）。 */
function EmptyState() {
  useLocaleTick()
  return (
    <div className={css.empty}>
      <div className={css.emptyIcon}><IconNewChatOutline16 size={32} /></div>
      <div className={css.emptyTitle}>{t('emptyTitle')}</div>
      <div className={css.emptyText}>{t('emptyText')}</div>
    </div>
  )
}

/** 加载 / 错误整屏态（标题 + 可选详情 + 可选指引）。 */
function StateScreen(props: { title: string; detail?: string; hint?: string }) {
  useLocaleTick()
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
  useLocaleTick()
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
                <summary>{t('thinking')}</summary>
                <div className={css.reasoningBody}>{message.reasoning}</div>
              </details>
            )}
            {message.text !== ''
              ? <MarkdownText text={message.text} streaming={message.streaming} codeLabels={codeLabels()} />
              : message.streaming === true && <div className={css.streamingHint}>{t('writing')}</div>}
            {message.interrupted === true && <div className={css.noticeRow}>{t('stopped')}</div>}
          </div>
        </div>
      )
    case 'tool':
      return (
        <div className={css.toolCard}>
          <div className={css.toolHead}>
            {t('toolLabel')} · {message.toolName}
            {message.isError === true && <span className={css.toolError}>{t('failed')}</span>}
            {message.streaming === true && <span className={css.toolRunning}>{t('running')}</span>}
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

/** 底部 composer：自绘输入框；模型标签显示子会话真实当前模型（fork 时同步主会话选择）。 */
function ComposerBar(props: {
  ctx: Context
  session: SessionFace | undefined
  composer: Composer
  running: boolean
  visible: boolean
  modelName: string | null
}) {
  useLocaleTick()
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
        placeholder={t('inputPlaceholder')}
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
        <span className={css.modelLabel}>{t('modelLabel', { name: props.modelName ?? t('modelFollowsMain') })}</span>
        {running
          ? (
            <button
              type="button"
              className={css.stopButton}
              title={t('stopReplyTitle')}
              onClick={() => { session?.cancel().catch(() => {}) }}
            >
              <IconStopFill16 size={14} /> {t('stopReply')}
            </button>
          )
          : (
            <button
              type="button"
              className={css.sendButton}
              disabled={composer.draft.trim() === ''}
              onClick={() => { composer.submit() }}
            >
              <IconSendOutline16 size={14} /> {t('send')}
            </button>
          )}
      </div>
      {composer.sendError !== null && <div className={css.errorRow}>{composer.sendError}</div>}
    </div>
  )
}
