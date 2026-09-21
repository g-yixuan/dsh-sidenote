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
 * - meta 无原生面（原生布局 memory-only）：全部走自有 metaStore；
 *   openTab → 面板挂载的窗口期内，初始值（parentSessionId/pendingDraft/恢复
 *   用的 childId）经 openTab params 随宿主管道投递，面板挂载时落进 store。
 *
 * 单实例语义（Delivery_01）：held 规则下同 pane 同 kind 去重，「新建」由
 * 编排层折叠为聚焦既有（open.ts），注册层不感知；多实例等 Delivery_02
 * 的 multiple（0.1.6+）放开。
 */
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
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
import { SideChatPanel } from './SideChatPanel.tsx'
import { SIDE_TAB_TYPE } from './model.ts'
import {
  dropSideChatMeta,
  nextSideChatNumber,
  notifySideChatMetaListeners,
  readSideChatMeta,
  sideChatMetaStore,
  writeSideChatMeta,
} from './metaStore.ts'
import { recordClosedSideChat } from './recentClosed.ts'
import { t } from '../locales.ts'
import css from './sidechat.module.css'

/** 原生注册表里的实现 id（槽 key；kind 沿用 SIDE_TAB_TYPE 保持自文档化）。 */
const NATIVE_IMPL_ID = 'dsh-sidenote:side-chat'

/** openTab params 的形态（窗口期投递的初始 meta；宿主管道，JSON-shaped）。 */
export interface SideChatOpenParams {
  /** 面板归属的主会话（metaStore 初始记录的 sessionId）。 */
  parentSessionId: string
  /** 首开待投递草稿。 */
  pendingDraft?: string
  /** 后悔药重开：既有子会话（走绑定恢复，不重新 fork）。 */
  childId?: string
}

export function parseOpenParams(params: unknown): SideChatOpenParams | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  const p = params as Record<string, unknown>
  if (typeof p.parentSessionId !== 'string' || p.parentSessionId === '') return undefined
  return {
    parentSessionId: p.parentSessionId,
    ...(typeof p.pendingDraft === 'string' && p.pendingDraft !== '' ? { pendingDraft: p.pendingDraft } : {}),
    ...(typeof p.childId === 'string' && p.childId !== '' ? { childId: p.childId } : {}),
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
export function reconcileMeta(record: NativeTabRecord, sessionId: string): boolean {
  if (readSideChatMeta(record.id) !== undefined) return false
  const params = parseOpenParams(record.navigation.params)
  writeSideChatMeta({
    tabId: record.id,
    sessionId,
    ...(params?.childId !== undefined ? { childId: params.childId } : {}),
    parentSessionId: params?.parentSessionId ?? sessionId,
    ...(params?.pendingDraft !== undefined ? { pendingDraft: params.pendingDraft } : {}),
    number: nextSideChatNumber(sessionId),
    createdAt: Date.now(),
  }, { silent: true })
  return true
}

/** 芯片标题：metaStore 的编号兑现（「侧边」/「侧边 N」）。 */
export function titleOf(tabId: string): string {
  const meta = readSideChatMeta(tabId)
  if (meta === undefined || meta.number <= 1) return t('tabBaseTitle')
  return `${t('tabBaseTitle')} ${meta.number}`
}

/** Body 注册的注入（插件根 ctx + 会话身份 + reflow store，经槽 inject 工厂）。 */
interface NativeBodyInjected {
  readonly ctx: Context
  readonly sessionId: string
  readonly reflow: ReflowStore
}

/** 面板体：原生 tab → SideChatPanel 的 TabComponentProps 合成适配。 */
function NativeSideChatBody(props: NativeBodyInjected & NativeTabFrameworkProps): ReactNode {
  const { ctx, sessionId, reflow, useTabInfo } = props
  const info: NativeTabInfo = useTabInfo()
  const nativeTab = info.tab

  // meta 初始登记（渲染期幂等；见 reconcileMeta 的时序说明）。
  const reconciled = reconcileMeta(nativeTab, sessionId)
  useEffect(() => {
    if (reconciled) notifySideChatMetaListeners()
  }, [reconciled])

  const cwd = useSessionCwd(ctx, sessionId)
  const scope = useMemo((): SessionScope => ({ sessionId, ...(cwd !== undefined ? { cwd } : {}) }), [sessionId, cwd])

  // meta 变更驱动重渲（fork 登记 childId、草稿清除等）。
  useSyncExternalStore(sideChatMetaStore.subscribe, sideChatMetaStore.getSnapshot)
  const meta = readSideChatMeta(nativeTab.id)

  // 关闭登记（后悔药数据源）：原生 tab 的 × 不经插件（0.1.5 无 close
  // handler 面），而 tab record 的 signal 会在 record 消失时 abort——面板
  // 卸载后一拍检查：已 abort = 真关闭（登记 + 清 meta）；未 abort = 切会话/
  // 布局重挂载（不动，reconcile 幂等）。recentClosed 语义与 legacy 腿的
  // descriptor.onClose 一致（会话本体仍归档在盘，重开走绑定恢复）。
  const tabSignal = nativeTab.signal
  useEffect(() => () => {
    setTimeout(() => {
      if (tabSignal?.aborted !== true) return
      const closed = readSideChatMeta(nativeTab.id)
      if (closed?.childId !== undefined && closed.parentSessionId !== undefined) {
        recordClosedSideChat(closed.parentSessionId, {
          childId: closed.childId,
          parentSessionId: closed.parentSessionId,
          title: titleOf(nativeTab.id),
          closedAt: Date.now(),
        })
      }
      dropSideChatMeta(nativeTab.id)
    }, 0)
  }, [nativeTab.id, tabSignal])

  const tab: SidebarTab = {
    id: nativeTab.id,
    type: SIDE_TAB_TYPE,
    title: titleOf(nativeTab.id),
    ...(meta === undefined ? {} : { meta }),
  }

  return (
    <div className={css.nativeHost} data-dsh-sidenote-native-host="">
      <SideChatPanel ctx={ctx} store={undefined} scope={scope} tab={tab} visible={nativeTab.visible} reflow={reflow} />
    </div>
  )
}

/** 芯片活标题：metaStore 订阅 + 编号标题。 */
function NativeSideChatTitle(props: NativeBodyInjected & NativeTabFrameworkProps): ReactNode {
  const { useTabInfo } = props
  const info = useTabInfo()
  useSyncExternalStore(sideChatMetaStore.subscribe, sideChatMetaStore.getSnapshot)
  return titleOf(info.tab.id)
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
export function registerNativeSideChatTab(ctx: Context, reflow: ReflowStore): void {
  ctx.inject(['sidebarRightTabs'], (injected) => {
    const tabs = injected.get('sidebarRightTabs') as unknown as NativeTabRegistry | undefined
    if (tabs === undefined) return
    const disposeType = tabs.register({
      id: NATIVE_IMPL_ID,
      kind: SIDE_TAB_TYPE,
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
      inject: (sessionId: unknown) => ({ ctx, sessionId: sessionId as string, reflow }),
    }, NativeSideChatBody))
    const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: NATIVE_IMPL_ID,
      inject: (sessionId: unknown) => ({ ctx, sessionId: sessionId as string, reflow }),
    }, NativeSideChatTitle))
    return () => {
      disposeBody()
      disposeTitle()
      disposeType()
    }
  })
}
