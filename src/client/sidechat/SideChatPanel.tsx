/**
 * 侧边聊天 Tab 面板（L2 薄视图）：相位编排 + 消息流 + composer。
 * 宿主接线（fork/archive/模型同步/Tab meta/窗口打开）全部在 lifecycle.ts（L3）——
 * 本文件无直接宿主调用（WI-00 分层纪律）。
 *
 * 打开流程（design.md 详细方案 2）：组件挂载时 tab.meta 无 childId →
 * lifecycle.forkAndRegister（fork 全量快照 → 归档隐藏 → meta 登记 → 模型同步）。
 * 恢复流程：有 meta.childId → ctx.sessions.binding(childId) 直接绑定；
 * 列表就绪后仍不在列 → 「会话已不存在」态。
 *
 * 消息流：binding.session 快照订阅（useSyncExternalStore），visible=false 时
 * 暂停订阅。非 staged 会话需 off-face open() 开窗（lifecycle.openSessionWindow），
 * 否则消息流永远为空（client-runtime 只为 staged 会话开窗的已知偏差）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconCheckOutline16, IconNewChatOutline16, IconSendOutline16, IconShareOutline16, IconStopFill16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SessionFace, TabComponentProps } from '../host/contracts.ts'
import { useComposer, type Composer } from './composer.ts'
import { clearPendingDraft, pairQuestions, parseSideChatMeta, phaseOf, transcriptOf, type ChatMessage } from './model.ts'
import { ensurePanelOpen, forkAndRegister, openSessionWindow, readModelName, updateTabMeta } from './lifecycle.ts'
import { flattenReflowContent, splitProtocolPrefix } from '../annotate/format.ts'
import { markdownTextProps } from '../host/markdown.ts'
import type { ReflowStore } from '../reflow.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

const NOOP_UNSUBSCRIBE = (): void => {}

export function SideChatPanel(props: TabComponentProps & { reflow: ReflowStore }) {
  useLocaleTick()
  const { ctx, scope, tab, visible } = props
  const meta = parseSideChatMeta(tab.meta)
  const childId = meta.childId
  const [forkError, setForkError] = useState<string | null>(null)
  const forkStarted = useRef(false)

  // 程序化入口（/side、bridge 划选提问）打开 Tab 时面板可能处于折叠态，
  // 挂载即幂等展开（编排细节在 lifecycle.ts）。
  const { store } = props
  useEffect(() => {
    ensurePanelOpen(store)
  }, [store])

  // ── 首开：fork → archive → 登记 meta（编排细节在 lifecycle.ts） ──
  useEffect(() => {
    if (childId !== undefined || forkStarted.current) return
    forkStarted.current = true
    let cancelled = false
    forkAndRegister(ctx, scope.sessionId, tab.id)
      .catch((error) => {
        if (!cancelled) setForkError(error instanceof Error ? error.message : String(error))
      })
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
    void readModelName(ctx, childId).then((name) => {
      if (!cancelled && name !== null) setModelName(name)
    })
    return () => { cancelled = true }
  }, [ctx, childId, session])

  // ── 桥接草稿移交：meta.pendingDraft → composer 草稿，应用后清除 ──
  const pendingDraft = meta.pendingDraft
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (pendingDraft === undefined || pendingDraft === '' || phase !== 'chat') return
    composer.appendDraft(pendingDraft)
    updateTabMeta(ctx, tab.id, clearPendingDraft)
    // 划选提问的落点体验：草稿注入后焦点直达输入框，用户接着打字即可。
    // visible 预聚焦 effect 只在可见性跳变时跑，已可见的 tab 覆盖不到。
    requestAnimationFrame(() => { rootRef.current?.querySelector('textarea')?.focus() })
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
    <div ref={rootRef} className={css.root}>
      <div ref={bodyRef} className={css.body}>
        {messages.length === 0 && !running
          ? <EmptyState />
          : <MessageList messages={messages} reflow={props.reflow} parentSessionId={meta.parentSessionId} sideTitle={tab.title} />}
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

function MessageList({ messages, reflow, parentSessionId, sideTitle }: {
  messages: readonly ChatMessage[]
  reflow: ReflowStore
  parentSessionId: string | undefined
  sideTitle: string
}) {
  // 问答成对：每条 assistant 消息配对它在回答的用户提问（回流时带上）。
  const questions = useMemo(() => pairQuestions(messages), [messages])
  return (
    <div className={css.transcript}>
      {messages.map(message => <MessageRow key={message.key} message={message} question={questions.get(message.key)} reflow={reflow} parentSessionId={parentSessionId} sideTitle={sideTitle} />)}
    </div>
  )
}

/** 回流按钮（W04 v2）：把这条 assistant 结论收为主会话的受控回流对象
 *  （主 composer 上方出现「侧边回流」chip），发送时随拦截器序列化。
 *  问答成对：带上它回答的那条用户提问（question 缺省时只有 <答>）。 */
function ReflowButton({ reflow, parentSessionId, sideTitle, text, question }: {
  reflow: ReflowStore
  parentSessionId: string | undefined
  sideTitle: string
  text: string
  question?: string
}) {
  useLocaleTick()
  const [done, setDone] = useState(false)
  const timer = useRef(0)
  // 卸载清定时器（C2 P2-7）。
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  if (parentSessionId === undefined) return null
  return (
    <button
      type="button"
      className={css.reflowButton}
      title={done ? t('reflowDone') : t('reflowToMain')}
      aria-label={t('reflowToMain')}
      onClick={() => {
        reflow.add(parentSessionId, sideTitle, text, question)
        setDone(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { setDone(false) }, 1600)
      }}
    >
      {done ? <IconCheckOutline16 size={12} /> : <IconShareOutline16 size={12} />}
    </button>
  )
}

function MessageRow({ message, question, reflow, parentSessionId, sideTitle }: {
  message: ChatMessage
  question?: string
  reflow: ReflowStore
  parentSessionId: string | undefined
  sideTitle: string
}) {
  useLocaleTick()
  switch (message.role) {
    case 'user': {
      // 带协议前缀的消息（注释/回流）在自绘面板同样留痕渲染：
      // 标签 + 正文，协议区不进界面（与宿主气泡手术同语义）。
      const proto = splitProtocolPrefix(message.text)
      if (proto !== null) {
        return (
          <div className={css.userRow}>
            <div className={css.userBubble}>
              <span className={css.sentChipRow}>
                {proto.annotations.length > 0 && (
                  <span className={css.sentChip} title={proto.annotations.map(a => `${a.id}. 「${a.quote}」${a.note}`).join('\n')}>
                    {t('sentChipLabel', { n: proto.annotations.length })}
                  </span>
                )}
                {proto.reflows.length > 0 && (
                  <span className={css.sentChip} title={proto.reflows.map(r => `${r.source}: ${flattenReflowContent(r.content).slice(0, 200)}`).join('\n')}>
                    {t('reflowBubbleLabel')}
                  </span>
                )}
              </span>
              {message.text.slice(proto.length)}
            </div>
          </div>
        )
      }
      return (
        <div className={css.userRow}>
          <div className={css.userBubble}>{message.text}</div>
        </div>
      )
    }
    case 'assistant':
      return (
        <div className={css.assistantRow}>
          {message.text !== '' && message.streaming !== true && (
            <div className={css.rowActions}>
              <ReflowButton reflow={reflow} parentSessionId={parentSessionId} sideTitle={sideTitle} text={message.text} question={question} />
            </div>
          )}
          <div className={css.assistantBody}>
            {message.reasoning !== undefined && message.reasoning !== '' && (
              <details className={css.reasoning}>
                <summary>{t('thinking')}</summary>
                <div className={css.reasoningBody}>{message.reasoning}</div>
              </details>
            )}
            {message.text !== ''
              ? <MarkdownText {...markdownTextProps(message.text, message.streaming)} />
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
