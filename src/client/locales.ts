/**
 * dsh-sidenote 的双语层（zh/en），跟随 DSH 通用设置里的语言（`ctx.locale`，
 * Host-backed locale.preference，实时切换）。模式照 better-sidebar
 * `src/client/locales.ts`：attachLocale 挂服务，t() 读活动语言；
 * 服务缺失（独立组合/测试）时回退浏览器语言。
 * 本文件保持 react-free（L0 可测）；唯一的 react 绑定点在 locale-tick.ts。
 */

export const LOCALE_NS = 'dsh-sidenote'

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
  modelSwitchTitle: 'Switch the side chat model',
  permChipTitle: 'Permission mode',
  permFullAccess: 'Full access',
  modelFollowsMain: 'follows main session',
  stopReply: 'Stop',
  stopReplyTitle: 'Stop the current reply',
  send: 'Send',
  attachTitle: 'Attach images',
  attachRemove: 'Remove',

  // transcript fallbacks (node → message folding)
  imagePlaceholder: '[Image]',
  toolFallback: 'Tool',
  unknownError: 'Unknown error',
  modelRetryStarted: 'Model request failed, retrying…',
  modelRetryWaiting: 'Model request failed, waiting to retry…',
  maxTokens: 'Output hit the length limit; this turn was truncated.',
  runCommand: 'Run command {cmd}',
  commandNameFallback: 'command',
  compacted: 'Earlier conversation context was compacted.',

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
  sendToTarget: 'Send to: {title}',
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
  protocolHeader: 'I annotated {n} passage(s) of the conversation above:',

  // sent 留痕（气泡标签 + 只读回看）
  sentChipLabel: '{n} annotated',
  sentBadgeTitle: 'Sent annotation {n} (view only)',
  sentCardTitle: 'Annotation {n} (sent)',

  // chip
  clearAll: 'Clear all',
  chipNote: ' ({note})',

  // 顶栏入口 + 首次引导
  headerSide: 'Side',
  headerSideTitle: 'Open a side chat (forked from the current session)',
  hintText: 'Tip: select any text in a reply to annotate it or ask in a side chat',
  hintClose: 'Got it',

  // 回流通道（侧边 → 主会话）
  reflowToMain: 'Send back to main session',
  reflowFrom: 'From side chat ({title}):',
  reflowDone: 'Added above the main composer',
  reflowFailed: "Couldn't reach the main session",
  reflowChipOne: '1 side-chat reflow',
  reflowChipMany: '{n} side-chat reflows',
  reflowReason: 'brought back from a side chat by the user',
  reflowBubbleLabel: 'Side-chat context',
  reflowRemoveTitle: 'Remove reflow',

  // TerminalBlock labels（0.1.2 运行时不传 labels 会崩——W00 排障实证）
  termSignal: 'Terminated ({signal})',
  termExitCode: 'Exit code {code}',
  termDone: 'done',
  termNoOutput: '(no output)',
  termCollapse: 'Collapse',
  termCollapseAria: 'Collapse the output',
  termExpand: 'Show all ({n} hidden lines)',
  termExpandAria: 'Show all ({n} hidden lines)',

  // D1 父历史折叠卡
  inheritedLabel: 'Inherited from main session · up to the fork point · {n}',

  // P1-4 密度管理
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  jumpToLatest: '↓ Jump to latest',

  // 工具卡叶子块 labels（0.1.2 起必填——host/labels.ts）
  readWindow: '{shown} of {total} lines',
  searchPathsSummary: '{shown} of {total} paths',
  searchMatchesSummary: '{shown} of {total} matches in {files} files',
  searchNoResults: 'No results',
  diffFiles: '{n} files',
  webNoResults: 'No results',
  webSourcesTruncated: 'Source list truncated',
  webContentTruncated: 'Content truncated',
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
  modelSwitchTitle: '切换侧边聊天模型',
  permChipTitle: '权限模式',
  permFullAccess: 'Full access',
  modelFollowsMain: '跟随主会话',
  stopReply: '停止',
  stopReplyTitle: '停止当前回复',
  send: '发送',
  attachTitle: '添加图片附件',
  attachRemove: '移除',

  imagePlaceholder: '[图片]',
  toolFallback: '工具',
  unknownError: '未知错误',
  modelRetryStarted: '模型请求失败，正在自动重试…',
  modelRetryWaiting: '模型请求失败，等待自动重试…',
  maxTokens: '输出达到长度上限，本轮回复已截断。',
  runCommand: '执行命令 {cmd}',
  commandNameFallback: '命令',
  compacted: '已压缩更早的对话上下文。',

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
  sendToTarget: '发送至：{title}',
  deleteNote: '删除注释',
  cancel: '取消',
  save: '保存',

  chipOne: '1 条注释',
  chipMany: '{n} 条注释',
  removeTitle: '移除注释',
  removeAria: '移除注释 {n}',

  noteLine: '注解：{note}',
  noNote: '（无注解）',
  protocolHeader: '我批注了以下 {n} 处内容：',

  sentChipLabel: '批注 ×{n}',
  sentBadgeTitle: '已发送的注释 {n}（只读回看）',
  sentCardTitle: '注释 {n}（已发送）',

  clearAll: '清空全部',
  chipNote: '（{note}）',

  headerSide: '侧边',
  headerSideTitle: '打开侧边聊天（从当前会话 fork）',
  hintText: '小技巧：划选回复里的文字，可以加注解或在侧边提问',
  hintClose: '知道了',

  reflowToMain: '回流到主会话',
  reflowFrom: '来自侧边聊天（{title}）：',
  reflowDone: '已回流到主会话输入框上方',
  reflowFailed: '主会话不可达',
  reflowChipOne: '1 条侧边回流',
  reflowChipMany: '{n} 条侧边回流',
  reflowReason: '用户选择从侧边聊天带回主线',
  reflowBubbleLabel: '含侧边回流上下文',
  reflowRemoveTitle: '移除回流',

  termSignal: '已终止（{signal}）',
  termExitCode: '退出码 {code}',
  termDone: '完成',
  termNoOutput: '（无输出）',
  termCollapse: '收起',
  termCollapseAria: '收起输出',
  termExpand: '展开全部（隐藏 {n} 行）',
  termExpandAria: '展开全部（隐藏 {n} 行）',

  inheritedLabel: '继承自主会话 · 截至 fork 点 · {n} 条',

  collapseAll: '全部折叠',
  expandAll: '全部展开',
  jumpToLatest: '↓ 跳到最新',

  readWindow: '{shown}/{total} 行',
  searchPathsSummary: '{shown}/{total} 个路径',
  searchMatchesSummary: '{shown}/{total} 处匹配 · {files} 个文件',
  searchNoResults: '无结果',
  diffFiles: '{n} 个文件',
  webNoResults: '无结果',
  webSourcesTruncated: '来源列表已截断',
  webContentTruncated: '内容已截断',
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

/** uSES 快照源（locale-tick.ts 专用出口）：语言字符串本身即快照。 */
export function localeSnapshot(): string {
  return localeService?.getSnapshot().active ?? 'en'
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
