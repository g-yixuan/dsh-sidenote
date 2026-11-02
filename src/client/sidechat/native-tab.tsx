/**
 * 直连注册层（Workitem_02）：侧聊 tab 类型直连 DSH 原生右栏（≥ 0.1.5-rc.1）。
 *
 * better-sidebar 0.19+ 把右栏让渡给原生 sidebarRight 后只剩纯转发——本模块
 * 绕开转发层，把侧聊类型直接注册进原生面：
 *
 * - 类型注册必须**等服务**（ctx.inject(['sidebarRightTabs'])）而非等槽声明：
 *   原生栏先声明 sidebar.right.pane.tab 槽、约 3 秒后才 provide 注册表服务，
 *   等槽触发会永久静默不注册（better-sidebar native/index.ts 的真机教训）。
 * - 面板体挂 sidebar.right.pane.tab keyed 槽（key = 注册实现 id）；
 *   芯片活标题挂 sidebar.right.pane.tab.title 槽（编号读 metaStore）。
 * - meta 无原生面：全部走自有 metaStore；
 *   openTab → 面板挂载的窗口期内，初始值（parentSessionId/pendingDraft/恢复
 *   用的 childId）经 openTab params 随宿主管道投递，面板挂载时落进 store。
 *
 * multiple 为每次打开保留独立标签；keepMounted 保留已访问面板，
 * 使切换标签不等同于关闭，后台输入、运行与恢复继续使用原会话。
 */
import { Component, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { IconNewChatOutline16 } from '../host/icons.ts'
import type {
  Context,
  NativeTabFrameworkProps,
  NativeTabInfo,
  NativeTabRecord,
  NativeTabRegistry,
  SessionScope,
  SidebarTab,
} from '../host/contracts.ts'
import type { ReflowStore } from '../reflow.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import { SideChatPanel } from './SideChatPanel.tsx'
import { SIDE_TAB_TYPE } from './model.ts'
import { forgetSideChatOpening } from './native.ts'
import { sideChatTitleOf } from './identity.ts'
import { closeNativeTab, isRestoredNativeTab } from '../host/tabs.ts'
import { parseSideChatMeta, type SideChatOpenParams } from './model.ts'
import { forgetClosedTabBinding, listClosedSideChats, rememberSideChat } from './recentClosed.ts'
import {
  SIDENOTE_RUN_ID,
  dropSideChatMeta,
  nextSideChatNumber,
  notifySideChatMetaListeners,
  readSideChatMeta,
  sideChatMetaStore,
  takeRestoredSideChatMeta,
  writeSideChatMeta,
} from './metaStore.ts'
import { t } from '../locales.ts'
import css from './sidechat.module.css'
import { renderSideConversation, type ConversationRendererProps } from './NativeConversation.tsx'

/** 原生注册表里的实现 id（槽 key；kind 沿用 SIDE_TAB_TYPE 保持自文档化）。 */
const NATIVE_IMPL_ID = 'dsh-sidenote:side-chat'

export function parseOpenParams(params: unknown): SideChatOpenParams | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  const p = params as Record<string, unknown>
  if (typeof p.parentSessionId !== 'string' || p.parentSessionId === '') return undefined
  return {
    parentSessionId: p.parentSessionId,
    ...(typeof p.pendingDraft === 'string' && p.pendingDraft !== '' ? { pendingDraft: p.pendingDraft } : {}),
    ...(typeof p.childId === 'string' && p.childId !== '' ? { childId: p.childId } : {}),
    ...(typeof p.topic === 'string' && p.topic !== '' ? { topic: p.topic } : {}),
    ...(typeof p.savedMeta === 'object' && p.savedMeta !== null ? { savedMeta: {
      ...parseSideChatMeta(p.savedMeta),
      ...(typeof (p.savedMeta as { number?: unknown }).number === 'number' ? { number: (p.savedMeta as { number: number }).number } : {}),
    } } : {}),
  }
}

/**
 * 渲染期把 params 的初始值幂等落进 metaStore（静默写，不 notify——渲染期
 * notify 会让订阅者（title 槽）触发 React「渲染中更新」警告；由调用方在
 * effect 里补 notify）。必须在渲染期完成：子组件 SideChatPanel 的 fork
 * effect 先于本组件的 effect 执行（React effect 自底向上），reopen 场景
 * 若在 effect 里登记，子面板会先按「无 childId」错误地重新 fork 出孤儿会话。
 * @returns true = 本次新建了记录（调用方 effect 里补 notify）。
 */
export function reconcileMeta(record: NativeTabRecord, sessionId: string): { created: boolean, meta: import('./metaStore.ts').SideChatMetaRecord } {
  const existing = readSideChatMeta(sessionId, record.id)
  if (existing !== undefined) return { created: false, meta: existing }
  const params = parseOpenParams(record.navigation.params)
  // Revision 0 is the public TabDomain marker for a restored/seeded record;
  // ordinary openTab navigations have a positive revision. A stale meta key
  // alone cannot reopen a tab, nor can a newly minted tab reclaim an old child.
  const candidate = takeRestoredSideChatMeta(sessionId, record.id)
  const restoredRecord = isRestoredNativeTab(record)
  const closed = restoredRecord
    ? listClosedSideChats(sessionId).find(entry => entry.tabId === record.id && entry.parentSessionId === sessionId)
    : undefined
  if (!restoredRecord) forgetClosedTabBinding(sessionId, record.id)
  const restored = restoredRecord ? candidate ?? (closed === undefined ? undefined : {
    ...parseSideChatMeta(closed.savedMeta), childId: closed.childId, parentSessionId: sessionId,
    ...(closed.topic !== undefined ? { topic: closed.topic } : {}),
    number: closed.savedMeta?.number,
    createdAt: closed.closedAt,
  }) : undefined
  const meta = {
    ...restored,
    ...params?.savedMeta,
    tabId: record.id,
    nativeAddress: record.navigation.address,
    sessionId,
    ...(params?.childId !== undefined ? { childId: params.childId } : {}),
    parentSessionId: params?.parentSessionId ?? sessionId,
    ...(params?.pendingDraft !== undefined ? { pendingDraft: params.pendingDraft } : {}),
    ...(params?.topic !== undefined ? { topic: params.topic } : {}),
    number: params?.savedMeta?.number ?? restored?.number ?? nextSideChatNumber(sessionId),
    createdAt: restored?.createdAt ?? Date.now(),
    runId: SIDENOTE_RUN_ID,
  }
  if (!record.signal.aborted) writeSideChatMeta(meta, { silent: true })
  return { created: !record.signal.aborted, meta }
}

/** 芯片标题：metaStore 兑现（topic 优先，编号回退——Delivery_05 单源）。 */
export function titleOf(sessionId: string, tabId: string): string {
  return sideChatTitleOf(readSideChatMeta(sessionId, tabId))
}

/** Titles also mount for unvisited tabs, so restore their identity before commands enumerate them. */
function useSideChatMeta(record: NativeTabRecord, sessionId: string) {
  const { created, meta } = reconcileMeta(record, sessionId)
  const createdRef = useRef(false)
  if (created) createdRef.current = true
  useSyncExternalStore(sideChatMetaStore.subscribe, sideChatMetaStore.getSnapshot)
  useEffect(() => {
    if (createdRef.current) {
      createdRef.current = false
      notifySideChatMetaListeners()
    }
  }, [])
  useEffect(() => {
    const onAbort = (): void => {
      const current = readSideChatMeta(sessionId, record.id)
      rememberSideChat(record.id, sideChatTitleOf(current), current)
      forgetSideChatOpening(sessionId, record.id)
      dropSideChatMeta(sessionId, record.id)
    }
    if (record.signal.aborted) { onAbort(); return }
    record.signal.addEventListener('abort', onAbort, { once: true })
    return () => { record.signal.removeEventListener('abort', onAbort) }
  }, [sessionId, record.id, record.signal])
  return readSideChatMeta(sessionId, record.id) ?? meta
}

/** Body 注册的注入（插件根 ctx + 会话身份 + reflow store，经槽 inject 工厂）。 */
interface NativeBodyInjected {
  readonly ctx: Context
  readonly sessionId: string
  readonly reflow: ReflowStore
  readonly annotations: AnnotationStore
}

/** 面板体外壳：把 useTabInfo（可能对未提交 record throw）也包进错误边界。 */
function NativeSideChatBody(props: NativeBodyInjected & NativeTabFrameworkProps & ConversationRendererProps): ReactNode {
  return (
    <NativeTabBoundary>
      <NativeSideChatBodyInner {...props} />
    </NativeTabBoundary>
  )
}

/** 面板体：原生 tab → SideChatPanel 的 TabComponentProps 合成适配。 */
function NativeSideChatBodyInner(props: NativeBodyInjected & NativeTabFrameworkProps & ConversationRendererProps): ReactNode {
  const { ctx, sessionId, reflow, annotations, useTabInfo } = props
  const info: NativeTabInfo = useTabInfo()
  const nativeTab = info.tab

  const meta = useSideChatMeta(nativeTab, sessionId)

  const cwd = useSessionCwd(ctx, sessionId)
  const scope = useMemo((): SessionScope => ({ sessionId, ...(cwd !== undefined ? { cwd } : {}) }), [sessionId, cwd])

  const tab: SidebarTab = {
    id: nativeTab.id,
    type: SIDE_TAB_TYPE,
    title: titleOf(sessionId, nativeTab.id),
    ...(meta === undefined ? {} : { meta }),
  }

  if (isRestoredNativeTab(nativeTab) && !meta.childId) return <div role="alert" className={css.errorRow}>{t('sideRestoreMissing')}</div>

  return (
    <div className={css.nativeHost} data-dsh-sidenote-native-host="">
      <SideChatPanel ctx={ctx} store={undefined} scope={scope} tab={tab} visible={nativeTab.visible} closeSource={() => closeNativeTab(nativeTab)} reflow={reflow} annotations={annotations} renderConversation={(reference, side) => renderSideConversation(props, reference, side)} />
    </div>
  )
}

/** 极简错误边界：渲染期 throw 兜成错误态，不逃到原生 seat（直连后不再有
 *  better-sidebar 的 RenderBoundary 包裹）。 */
class NativeTabBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null }
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  override componentDidCatch(error: unknown): void {
    console.warn('[dsh-sidenote] 侧聊面板渲染崩溃:', error)
  }
  override render(): ReactNode {
    if (this.state.error !== null) {
      return <div style={{ padding: 16, fontSize: 13 }}>{t('sideChatCrashed')}{this.state.error}</div>
    }
    return this.props.children
  }
}

/** 芯片活标题：metaStore 订阅 + 编号标题。 */
function NativeSideChatTitle(props: NativeBodyInjected & NativeTabFrameworkProps): ReactNode {
  const { useTabInfo } = props
  const info = useTabInfo()
  return sideChatTitleOf(useSideChatMeta(info.tab, props.sessionId))
}

/** 会话工作区根（better-sidebar useSessionCwd 同款）。 */
function useSessionCwd(ctx: Context, sessionId: string): string | undefined {
  return useSyncExternalStore(
    useMemo(() => (listener: () => void) => ctx.sessions.list.subscribe(listener), [ctx]),
    () => {
      const row = ctx.sessions.list.getSnapshot().byId?.[sessionId]
      return (row as { cwd?: string } | undefined)?.cwd
    },
  )
}

/**
 * 直连注册：类型 + body/title 槽。返回 disposer（插件 fiber 撤销时清场）。
 * 探测与分腿在调用方（sidechat/index.tsx）；本函数只在 sidebarRightTabs
 * 存在时被调用。
 */
export function registerNativeSideChatTab(ctx: Context, reflow: ReflowStore, annotations: AnnotationStore): void {
  ctx.inject(['sidebarRightTabs'], (injected) => {
    const tabs = injected.get('sidebarRightTabs') as unknown as NativeTabRegistry | undefined
    if (tabs === undefined) return
    const disposeType = tabs.register({
      id: NATIVE_IMPL_ID,
      kind: SIDE_TAB_TYPE,
      multiple: true,
      keepMounted: true,
      priority: 'extension',
      // 静态兜底标题（open 时捕获）；活标题由 title 槽读 metaStore。
      title: () => t('tabBaseTitle'),
      guide: [{
        order: 60,
        title: () => t('menuTitle'),
        icon: (props: { size?: number }) => <IconNewChatOutline16 size={props.size ?? 16} />,
      }],
    })
    const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: NATIVE_IMPL_ID,
      children: { 'sidenote.conversation': { kind: 'single', scope: 'session' } },
      inject: (sessionId: unknown) => ({ ctx, sessionId: sessionId as string, reflow, annotations }),
    }, NativeSideChatBody))
    const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: NATIVE_IMPL_ID,
      inject: (sessionId: unknown) => ({ ctx, sessionId: sessionId as string, reflow, annotations }),
    }, NativeSideChatTitle))
    return () => {
      disposeBody()
      disposeTitle()
      disposeType()
    }
  })
}
