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
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SessionFace, TabComponentProps } from '../host/contracts.ts'
import { useComposer, type Composer } from './composer.ts'
import { clearPendingDraft, parseSideChatMeta, phaseOf } from './model.ts'
import { transcriptOf } from '../chat/transcript.ts'
import { EmptyState, MessageList, StateScreen } from './rows.tsx'
import { chatSourceOf, ensurePanelOpen, forkAndRegister, openSessionWindow, readModelName, updateTabMeta } from './lifecycle.ts'
import { ToolCard } from '../chat/ToolCard.tsx'
import { ComposerBar } from './ComposerBar.tsx'
import { ReasoningRow } from '../chat/ReasoningRow.tsx'
import { FoldCard } from '../chat/FoldCard.tsx'
import { createFoldStore } from '../chat/viewState.ts'
import type { ReflowStore } from '../reflow.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

const NOOP_UNSUBSCRIBE = (): void => {}

/** D2 写型工具名（无 diff 卡时的名字兜底）。 */
const WRITE_TOOLS = new Set(['edit', 'write', 'str-replace-editor', 'str_replace_editor'])
/** 首次写提示的一次性 localStorage 键。 */
const WRITE_NOTICE_KEY = 'dsh-sidenote:write-notice:v1'

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
  // 内容面双兼容（W00-fork-replay-012）：0.1.2 的 nodes/partial/runningCalls 在
  // uiConversation.chat target 的 .legacy 切片，0.1.1 在 Session 快照顶层。
  // chatSourceOf 探测链优先新面、miss 回退旧面；running/openState 两版都在
  // Session 快照上，继续读旧面。
  // 内容面双兼容（W00-fork-replay-012）：0.1.2 的 nodes/partial/runningCalls 在
  // uiConversation.chat target 的 .legacy 切片，0.1.1 在 Session 快照顶层。
  // chatSourceOf 探测链优先新面、miss 回退旧面；running/openState 两版都在
  // Session 快照上，继续读旧面。
  const chat = useMemo(
    () => chatSourceOf(ctx, childId === undefined ? undefined : ctx.sessions.binding(childId)),
    [ctx, childId, session],
  )
  const chatLegacy = useSyncExternalStore(
    useCallback(
      (notify: () => void) => (visible && chat !== undefined ? chat.subscribe(notify) : NOOP_UNSUBSCRIBE),
      [visible, chat],
    ),
    () => chat?.getLegacy() ?? null,
  )
  const messages = useMemo(() => transcriptOf(chatLegacy ?? snapshot), [chatLegacy, snapshot])

  // 折叠态外置 store（P0-2 状态零丢失的架构约束）：Tab 切换/重挂不丢展开态。
  // 注意：必须在相位早退之前创建（hooks 纪律——forking/error 相位渲染的
  // hooks 数与 chat 相位必须一致，否则 React #310「Rendered more hooks」）。
  const fold = useMemo(() => createFoldStore(childId === undefined ? undefined : `dsh-sidenote:fold:v1:${childId}`), [childId])

  // P0-4：主会话（父）运行状态订阅——三态指示（跑着/等审批/空闲）。
  // visible=false 暂停订阅（与消息流同纪律）。
  const parentSession = meta.parentSessionId === undefined
    ? undefined
    : ctx.sessions.binding(meta.parentSessionId)?.session
  const parentSnap = useSyncExternalStore(
    useCallback(
      (notify: () => void) => (visible && parentSession !== undefined ? parentSession.subscribe(notify) : NOOP_UNSUBSCRIBE),
      [visible, parentSession],
    ),
    () => (parentSession === undefined ? null : parentSession.getSnapshot()),
  )
  // D2 提示的消除态（hooks 纪律：必须在相位早退之前——#310 教训）。
  const [writeNoticeDismissed, setWriteNoticeDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(WRITE_NOTICE_KEY) === '1',
  )

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

  // P0-4 焦点切换：Alt+J 在主 ↔ 侧之间跳（code 判定而非 key——macOS
  // Option 组合会产 '∆' 等变体字符，code 布局无关稳定）。
  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.code !== 'KeyJ') return
      event.preventDefault()
      const inSide = rootRef.current?.contains(document.activeElement) === true
      if (inSide) {
        // 回主：聚焦主 composer（0.1.1 textarea / 0.1.2 contenteditable 双兼容）。
        const main = document.querySelector<HTMLElement>('[data-composer-seat] textarea, [data-composer-seat] [contenteditable]')
        main?.focus()
      } else {
        rootRef.current?.querySelector('textarea')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [visible])

  // 新消息自动跟滚：仅在用户本就在底部附近时跟（读历史时不被拽走——
  // Copilot #1167 滚动重置是用户恨点）；离开底部时浮「跳到最新」按钮。
  const bodyRef = useRef<HTMLDivElement>(null)
  const [nearBottom, setNearBottom] = useState(true)
  const tailKey = messages.length === 0 ? '' : `${messages[messages.length - 1]!.key}:${messages[messages.length - 1]!.text.length}:${messages[messages.length - 1]!.reasoning?.length ?? 0}`
  useEffect(() => {
    const el = bodyRef.current
    if (el !== null && visible && nearBottom) el.scrollTop = el.scrollHeight
  }, [tailKey, visible, nearBottom])
  // P0-2：滚动位置随会话持久化（刷新恢复）。
  const scrollKey = childId === undefined ? undefined : `dsh-sidenote:scroll:v1:${childId}`
  const scrollTimer = useRef(0)
  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current
    if (el === null) return
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    if (scrollKey !== undefined) {
      window.clearTimeout(scrollTimer.current)
      scrollTimer.current = window.setTimeout(() => {
        try { localStorage.setItem(scrollKey, String(el.scrollTop)) } catch { /* 隐私模式 */ }
      }, 300)
    }
  }, [scrollKey])
  const jumpToLatest = useCallback(() => {
    const el = bodyRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
    setNearBottom(true)
  }, [])

  // 滚动恢复：消息首次非空渲染后回跳一次（之后归 onScroll/nearBottom 管）。
  const scrollRestored = useRef(false)
  useEffect(() => {
    if (scrollRestored.current || scrollKey === undefined || messages.length === 0) return
    scrollRestored.current = true
    let saved: string | null = null
    try { saved = localStorage.getItem(scrollKey) } catch { /* ignore */ }
    if (saved !== null && bodyRef.current !== null) {
      bodyRef.current.scrollTop = Number(saved)
      const el = bodyRef.current
      setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    }
  }, [messages.length, scrollKey])

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
  // D2 补偿（同权语义）：侧聊首次出现写型工具（diff 卡 / edit·write 族）时
  // 给一次性轻提示——用户要「一眼知道它能动我文件」。
  const hasWriteTool = messages.some(m =>
    m.role === 'tool' && (m.card?.kind === 'diff' || (m.toolName !== undefined && WRITE_TOOLS.has(m.toolName))))
  // R8 审批提示条：pending 两版本分居（0.1.1 在 Session 快照顶层；0.1.2 在
  // 控制面——legacy 切片不含）。两面都读，兼容缺席。
  const pendingCount = (
    ((snapshot as { pending?: readonly unknown[] } | null)?.pending)
    ?? ((chatLegacy as { pending?: readonly unknown[] } | null)?.pending)
    ?? []
  ).length

  const parentPending = ((parentSnap as { pending?: readonly unknown[] } | null)?.pending ?? []).length
  const parentState = parentSession === undefined
    ? null
    : parentPending > 0 ? 'pending' : parentSnap?.running === true ? 'running' : 'idle'

  return (
    <div ref={rootRef} className={css.root}>
      {parentState !== null && meta.parentSessionId !== undefined && (
        <button
          type="button"
          className={css.parentStrip}
          title={t('parentStripTitle')}
          onClick={() => { if (meta.parentSessionId !== undefined) ctx.sessions.open(meta.parentSessionId) }}
        >
          <span className={parentState === 'running' ? css.dotRunning : parentState === 'pending' ? css.dotPending : css.dotIdle} />
          {t(parentState === 'running' ? 'parentRunning' : parentState === 'pending' ? 'parentPending' : 'parentIdle')}
        </button>
      )}
      <div ref={bodyRef} className={css.body} onScroll={onBodyScroll}>
        {messages.length === 0 && !running
          ? <EmptyState />
          : <MessageList messages={messages} fold={fold} boundarySeq={meta.boundarySeq} reflow={props.reflow} parentSessionId={meta.parentSessionId} sideTitle={tab.title} />}
        {openFailed && <div className={css.errorRow}>{t('historyFailed')}</div>}
      </div>
      {hasWriteTool && !writeNoticeDismissed && (
        <div className={css.writeNotice}>
          <span>{t('writeNotice')}</span>
          <button
            type="button"
            className={css.writeNoticeClose}
            aria-label={t('hintClose')}
            onClick={() => {
              setWriteNoticeDismissed(true)
              try { localStorage.setItem(WRITE_NOTICE_KEY, '1') } catch { /* 隐私模式 */ }
            }}
          >×</button>
        </div>
      )}
      {pendingCount > 0 && childId !== undefined && (
        <button
          type="button"
          className={css.pendingBar}
          onClick={() => { ctx.sessions.open(childId) }}
        >
          {t('pendingNotice')}
        </button>
      )}
      {!nearBottom && (
        <button type="button" className={css.jumpBottom} onClick={jumpToLatest}>
          {t('jumpToLatest')}
        </button>
      )}
      <ComposerBar ctx={ctx} session={session} composer={composer} running={running} visible={visible} modelName={modelName} childId={childId} onModelSwitched={setModelName} />
    </div>
  )
}
