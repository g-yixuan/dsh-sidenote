import { useSyncExternalStore } from 'react'

/**
 * dsh-sidechat 的双语层（zh/en），跟随 DSH 通用设置里的语言（`ctx.locale`，
 * Host-backed locale.preference，实时切换）。模式照 better-sidebar
 * `src/client/locales.ts`：attachLocale 挂服务，t() 读活动语言；
 * 服务缺失（独立组合/测试）时回退浏览器语言。
 */

export const LOCALE_NS = 'dsh-sidechat'

/** 英文词典（key 的权威清单）。 */
export const en = {
  menuTitle: 'Side chat',
  tabBaseTitle: 'Side',

  // SideChatPanel
  codeCopy: 'Copy',
  codeCopied: 'Copied',
  forkErrorTitle: "Couldn't create the side chat",
  forkErrorHint: 'The main session needs at least one completed turn to fork from. Close this tab with the × on the tab.',
  missingTitle: 'Session no longer exists',
  missingDetail: "This side chat's session was removed and can't be restored.",
  missingHint: 'Close this tab with the × on the tab.',
  preparing: 'Preparing the side chat…',
  historyFailed: 'Failed to load the session history. Close and reopen this tab.',
  emptyTitle: 'Side chat',
  emptyText: 'Forked from the current session and evolves independently. Closing the tab removes it.',
  thinking: 'Thinking',
  writing: 'Writing…',
  stopped: 'Stopped',
  toolLabel: 'Tool',
  failed: 'failed',
  running: 'running…',
  inputPlaceholder: 'Message… (Enter to send, Shift+Enter for a newline)',
  modelLabel: 'Model: {name}',
  modelFollowsMain: 'follows main session',
  stopReply: 'Stop',
  stopReplyTitle: 'Stop the current reply',
  send: 'Send',

  // /side command
  cmdDesc: 'Open a side chat (forked from the current session)',
  cmdNew: 'New side chat',
  cmdNewDetail: 'Forked from the current session; evolves independently',
  cmdFocus: 'Focus "{title}"',
  cmdFocusDetail: 'Existing side chat',

  // annotate overlay
  addToConversation: 'Add to conversation',
  askInSideChat: 'Ask in side chat',
  toolbarAria: 'Selection annotations',
  notePlaceholder: 'Add a note (optional)…',
  confirmTitle: 'Confirm',
  saveNoteAria: 'Save note',
  sideNotePlaceholder: 'Add a note for the side chat (optional)…',
  sideNoteAria: 'Side chat note',
  confirmAskAria: 'Confirm and ask',
  openSideFailed: "Couldn't open the side chat. Try again.",
  deleteNote: 'Delete annotation',
  cancel: 'Cancel',
  save: 'Save',

  // chip
  chipOne: '1 annotation',
  chipMany: '{n} annotations',
  removeTitle: 'Remove annotation',
  removeAria: 'Remove annotation {n}',

  // model-facing quote format
  noteLine: 'Note: {note}',
  noNote: '(no note)',
}

export type CopyKey = keyof typeof en

/** 中文词典（与 en 同 key）。 */
export const zh: Record<CopyKey, string> = {
  menuTitle: '侧边聊天',
  tabBaseTitle: '侧边',

  codeCopy: '复制',
  codeCopied: '已复制',
  forkErrorTitle: '无法创建侧边聊天',
  forkErrorHint: '主会话需要至少一轮已完成的对话才能 fork。点击标签上的 × 可关闭此标签页。',
  missingTitle: '会话已不存在',
  missingDetail: '此侧边聊天的会话已被移除，无法恢复。',
  missingHint: '点击标签上的 × 关闭此标签页。',
  preparing: '正在准备侧边聊天…',
  historyFailed: '会话历史加载失败，可关闭后重新打开此标签页。',
  emptyTitle: '侧边聊天',
  emptyText: '侧边聊天从当前会话 fork，独立演进；关闭标签页后消失。',
  thinking: '思考过程',
  writing: '正在输出…',
  stopped: '已停止',
  toolLabel: '工具',
  failed: '失败',
  running: '执行中…',
  inputPlaceholder: '输入消息…（Enter 发送，Shift+Enter 换行）',
  modelLabel: '模型：{name}',
  modelFollowsMain: '跟随主会话',
  stopReply: '停止',
  stopReplyTitle: '停止当前回复',
  send: '发送',

  cmdDesc: '打开侧边聊天（从当前会话 fork）',
  cmdNew: '新建侧边聊天',
  cmdNewDetail: '从当前会话 fork，独立演进',
  cmdFocus: '聚焦「{title}」',
  cmdFocusDetail: '已存在的侧边聊天',

  addToConversation: '添加到对话',
  askInSideChat: '在侧边聊天中提问',
  toolbarAria: '划选注释',
  notePlaceholder: '这里可以写自己的注解…',
  confirmTitle: '确认',
  saveNoteAria: '确认注解',
  sideNotePlaceholder: '给侧边聊天写个注解（可空）…',
  sideNoteAria: '侧边聊天注解',
  confirmAskAria: '确认并提问',
  openSideFailed: '打开侧边聊天失败，请重试',
  deleteNote: '删除注释',
  cancel: '取消',
  save: '保存',

  chipOne: '1 条注释',
  chipMany: '{n} 条注释',
  removeTitle: '移除注释',
  removeAria: '移除注释 {n}',

  noteLine: '注解：{note}',
  noNote: '（无注解）',
}

/** The DSH locale service face we consume (subset of LocaleRuntime). */
export interface LocaleServiceLike {
  getSnapshot(): { active: string }
  subscribe(fn: () => void): () => void
}

let localeService: LocaleServiceLike | undefined

/** Attach the DSH locale service (call once from the client apply). */
export function attachLocale(service: LocaleServiceLike | undefined): void {
  localeService = service
}

/** Subscribe to locale switches (component re-render driver). */
export function subscribeLocale(fn: () => void): () => void {
  return localeService?.subscribe(fn) ?? (() => {})
}

/** The active locale id：DSH 语言设置优先，缺失时回退浏览器语言。 */
function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const dict = activeLocale().toLowerCase().startsWith('zh') ? zh : en
  let text = dict[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** 语言切换时驱动组件重渲（useSyncExternalStore 标准接法）。 */
export function useLocaleTick(): void {
  useSyncExternalStore(subscribeLocale, () => localeService?.getSnapshot().active ?? 'en')
}
