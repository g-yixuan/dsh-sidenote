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
  diagTitle: 'Compatibility diagnostics',
  diagClose: 'Close compatibility diagnostics',
  diagMode: 'dsh-sidenote diagnostic mode',
  diagModeDescription: 'Enable while debugging or reporting a problem to inspect integration status.',
  diagModeUnsaved: 'This choice only applies to the current page because it could not be saved locally.',
  diagUnknownVersion: 'version unknown',
  diagDescription: 'Current integration status. This does not claim that a message was accepted or a model answered. Unreadable versions stay unknown.',
  diagNotDetected: 'not detected',
  diagPath: 'Integration details',
  diagRecheck: 'Recheck',
  diagExport: 'Export report',
  diagAvailable: 'Available', diagUnready: 'Waiting', diagUnknown: 'Unknown', diagUnavailable: 'Unavailable',
  diagReady: 'The current integration path can be read.',
  diagWaitSession: 'Waiting for the target session.',
  diagWaitService: 'Waiting for the host service.',
  diagWaitInput: 'Waiting for the target input.',
  diagUnsupported: 'The supplied interface lacks a required operation.',
  diagReadFailed: 'The host state could not be confirmed. Recheck after it is ready.',
  diagWaitView: 'Waiting for a loaded conversation view.',
  diagWaitDock: 'Waiting for the annotation dock.',
  diagWaitSide: 'Open a side chat to check its view.',
  diagUnknownAcceptance: 'No reliable message observation path has been confirmed.',
  diagMarkersMissing: 'The loaded view has no recognized assistant markers.',
  diagSelection: 'Main reply selection', diagDock: 'Main annotation chip', diagSideOpen: 'Side chat opening',
  diagSideQuote: 'Side reply selection', diagInput: 'Main input', diagSideInput: 'Side input',
  diagAcceptance: 'Message acceptance observation', diagChat: 'Conversation content', diagModel: 'Model controls',
  diagSideAcceptance: 'Side message acceptance',
  inputUnavailable: 'Cannot send right now. Body, attachments and quotes have been retained.',
  mainContext: 'Main conversation context',
  contextAtSend: 'Updates on first send',
  contextLatest: 'Back to latest',
  contextLoading: 'Loading context…',
  contextRetry: 'Retry',
  contextEmpty: 'No mainline context yet',
  contextCopy: 'Copy',
  contextCopied: 'Copied',
  contextFootnotes: 'Footnotes',
  contextImageFailed: 'Image could not be loaded',
  contextAsOf: 'As of {time}',
  contextInherited: 'Inherited history',
  contextrequest: 'Request',
  contextcheckpoint: 'Latest compaction summary',
  contextreply: 'Reply',
  contextthinking: 'Reasoning',
  contextstreaming: 'In progress',
  contextUnfinished: 'Unfinished at fork',
  inputWaiting: 'The input is not ready. Body, attachments and quotes have been retained. Please try again shortly.',
  draftRecoveryConflict: 'The host has another draft. Your local body is retained; review this session in the main view before retrying.',
  quoteWorkflowWaiting: 'Annotations are not ready yet. Please try again shortly.',

  menuTitle: 'Side chat',
  showSideSessions: 'Show side chats in the session list',
  showSideSessionsDescription: 'Side chats stay hidden by default. Enable this to find older side chats.',
  sideSessionsUnsaved: 'This choice only applies to the current page because it could not be saved locally.',
  tabBaseTitle: 'Side',

  // SideChatPanel
  codeCopy: 'Copy',
  codeCopied: 'Copied',
  jsonCopyValue: 'Copy value',
  jsonCopyJson: 'Copy JSON',
  jsonCopyPath: 'Copy path',
  jsonCopyPretty: 'Copy pretty JSON',
  jsonCopyCompact: 'Copy compact JSON',
  jsonCopyFailed: 'Copy failed',
  jsonCollapse: 'Collapse node',
  jsonExpand: 'Expand node',
  jsonTreeLabel: 'JSON payload',
  sideChatCrashed: 'Side chat panel crashed: ',
  forkErrorTitle: "Couldn't create the side chat",
  forkErrorHint: 'The main session needs at least one completed turn to fork from. Close this tab with the × on the tab.',
  missingTitle: 'Session no longer exists',
  missingDetail: "This side chat's session was removed and can't be restored.",
  missingHint: 'Close this tab with the × on the tab.',
  preparing: 'Preparing the side chat…',
  annotationStorageMemory: 'Saved only for this page. Reloading may lose changes.',
  historyFailed: 'Failed to load the session history. Close and reopen this tab.',
  emptyTitle: 'Side chat',
  emptyText: 'Forked from the current session and evolves independently. Closing the tab removes it.',
  thinking: 'Thinking',
  writing: 'Writing…',
  stopped: 'Stopped',
  toolLabel: 'Tool',
  failed: 'failed',
  todoTitle: 'Tasks',
  todoDone: '{n} done',
  todoDoing: '{n} in progress',
  todoPending: '{n} pending',
  running: 'running…',
  inputPlaceholder: 'Message… (Enter to send, Shift+Enter for a newline)',
  modelLabel: 'Model: {name}',
  modelSwitchTitle: 'Switch the side chat model',
  permChipTitle: 'Permission mode',
  permFullAccess: 'Full access',
  pendingNotice: '⚠ The side session has a pending approval/question — click to handle it in the main view',
  writeNotice: 'The side session shares the main session\'s permissions and can modify files (current mode: chip next to the input)',
  pendingApprovalTitle: 'Waiting for approval',
  pendingApprovalDesc: 'Tool {name} requests elevated execution',
  pendingReject: 'Reject',
  pendingAllowOnce: 'Allow once',
  pendingQuestionTitle: 'Question',
  pendingPlanReview: 'Plan review',
  pendingQuestionSubmit: 'Submit',
  pendingQuestionCancel: 'Cancel',
  pendingCustomPlaceholder: 'Custom answer…',
  modelFollowsMain: 'follows main session',
  stopReply: 'Stop',
  sideChatDone: '「{title}」finished replying',
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
  cmdReopen: 'Reopen "{title}"',
  closedJustNow: 'Closed just now',
  closedMinutesAgo: 'Closed {n} min ago',
  closedHoursAgo: 'Closed {n}h ago',
  closedYesterday: 'Closed yesterday',
  closedOnDate: 'Closed {month}/{day}',
  closedOnDateYear: 'Closed {year}/{month}/{day}',

  // annotate overlay
  addToConversation: 'Add to conversation',
  askInSideChat: 'Ask in side chat',
  toolbarAria: 'Selection annotations',
  notePlaceholder: 'Add a note (optional)…',
  confirmTitle: 'Confirm',
  saveNoteAria: 'Save note',
  editNoteAria: 'Edit note',
  selectedText: 'Selected text',
  userComment: 'Your comment',
  sideNotePlaceholder: 'Add a note for the side chat (optional)…',
  sideNoteAria: 'Side chat note',
  confirmAskAria: 'Confirm and ask',
  openSideFailed: "Couldn't open the side chat. Try again.",
  sideTargetWaiting: 'Waiting for the target side chat… Esc cancels.',
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
  clearAnnotations: 'Clear annotations',
  clearReflows: 'Clear side-chat reflows',
  chipNote: ' ({note})',

  // 顶栏入口 + 首次引导
  headerSide: 'Side',
  headerSideTitle: 'Open a side chat (forked from the current session)',
  hintText: 'Tip: select any text in a reply to annotate it or ask in a side chat',
  hintClose: 'Got it',

  // 回流通道（侧边 → 主会话）
  reflowToMain: 'Bring back to main conversation',
  sendAnnotations: 'Send annotations',
  reflowFrom: 'From side chat ({title}):',
  reflowDone: 'Added to main conversation, not sent yet',
  reflowFailed: "Couldn't reach the main session",
  reflowChipOne: '1 side-chat reflow',
  reflowChipMany: '{n} side-chat reflows',
  reflowReason: 'brought back from a side chat by the user',
  reflowBubbleLabel: 'Side-chat context',
  reflowRemoveTitle: 'Remove reflow',

  // TerminalBlock labels（0.1.2 运行时不传 labels 会崩——W00 排障实证）
  termCommandLine: 'Command line {n}',
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
  snapshotLabel: 'Mainline progress snapshot',
  snapshotLabelAt: 'Mainline progress snapshot · taken {at}',

  // P1-4 密度管理
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  jumpToLatest: '↓ Jump to latest',
  reflowAll: 'Reflow all',
  reflowAllTitle: 'Bring all Q&A pairs back to the main session',
  reflowAllDone: 'Reflowed ✓',
  promote: 'Save as session',
  promoteTitle: 'Fork this side chat into a standalone session in the main list',
  promoteBusy: 'Wait for the reply and queued messages to finish before saving',
  promoteDraftBusy: 'Send or clear the draft, attachments and annotations before saving',
  promoteDone: 'Saved as a regular session — it\'s open in the main view now',

  // 工具卡叶子块 labels（0.1.2 起必填——host/labels.ts）
  readWindow: '{shown} of {total} lines',
  searchPathsSummary: '{shown} of {total} paths',
  searchMatchesSummary: '{shown} of {total} matches in {files} files',
  searchNoResults: 'No results',
  diffFiles: '{n} files',
  webNoResults: 'No results',
  webSourcesTruncated: 'Source list truncated',
  webContentTruncated: 'Content truncated',

  // WI-03 主线状态条（P0-4 三态）
  parentStripTitle: 'Main session status — click to jump back',
  parentRunning: 'Main: running',
  parentPending: 'Main: awaiting your input',
  parentIdle: 'Main: idle',
}

export type CopyKey = keyof typeof en

/** 中文词典（与 en 同 key）。 */
export const zh: Record<CopyKey, string> = {
  diagTitle: '兼容诊断',
  diagClose: '关闭兼容诊断',
  diagMode: 'dsh-sidenote 诊断模式',
  diagModeDescription: '开发者调试或报告问题时开启，显示功能接入状态。',
  diagModeUnsaved: '无法保存到本地，本次选择仅在当前页面生效。',
  diagUnknownVersion: '版本未知',
  diagDescription: '显示当前接入状态，不代表消息已被接受或模型已回答。无法可靠读取的版本显示未知。',
  diagNotDetected: '未检测到',
  diagPath: '接入详情',
  diagRecheck: '重新检查',
  diagExport: '导出报告',
  diagAvailable: '可用', diagUnready: '等待就绪', diagUnknown: '尚未确认', diagUnavailable: '不可用',
  diagReady: '当前接入路径可读取。',
  diagWaitSession: '等待目标会话就绪。',
  diagWaitService: '等待宿主服务就绪。',
  diagWaitInput: '等待目标输入框就绪。',
  diagUnsupported: '已提供的接口缺少必要操作。',
  diagReadFailed: '暂时无法确认宿主状态，就绪后可重新检查。',
  diagWaitView: '等待会话视图加载。',
  diagWaitDock: '等待注释输入区就绪。',
  diagWaitSide: '打开侧聊后检查其视图。',
  diagUnknownAcceptance: '尚未确认可靠的消息观察路径。',
  diagMarkersMissing: '已加载视图没有可识别的 assistant 标记。',
  diagSelection: '主回复划选', diagDock: '主注释 chip', diagSideOpen: '侧聊开窗',
  diagSideQuote: '侧回复划选', diagInput: '主输入框', diagSideInput: '侧输入框',
  diagAcceptance: '消息接受观察', diagChat: '会话内容读取', diagModel: '模型控件',
  diagSideAcceptance: '侧聊消息接受',
  inputUnavailable: '暂时无法发送，正文、附件和注释已保留。',
  mainContext: '主线上下文',
  contextAtSend: '发送时更新',
  contextLatest: '回到最新',
  contextLoading: '正在加载上下文…',
  contextRetry: '重试',
  contextEmpty: '主线暂时没有上下文',
  contextCopy: '复制',
  contextCopied: '已复制',
  contextFootnotes: '脚注',
  contextImageFailed: '图片加载失败',
  contextAsOf: '截至 {time}',
  contextInherited: '已继承主线历史',
  contextrequest: '请求',
  contextcheckpoint: '最新压缩摘要',
  contextreply: '回答',
  contextthinking: '思考',
  contextstreaming: '正在输出',
  contextUnfinished: '分叉时未完成',
  inputWaiting: '输入尚未就绪，正文、附件和注释已保留，请稍后重试。',
  draftRecoveryConflict: '宿主另有草稿，本地正文已保留；请在主视图核对该会话草稿后再试。',
  quoteWorkflowWaiting: '注释功能暂未就绪，请稍后重试。',

  menuTitle: '侧边聊天',
  showSideSessions: '在会话列表中显示侧边聊天',
  showSideSessionsDescription: '侧聊默认隐藏；开启后可找回较早的侧聊。',
  sideSessionsUnsaved: '无法保存到本地，本次选择仅在当前页面生效。',
  tabBaseTitle: '侧边',

  codeCopy: '复制',
  codeCopied: '已复制',
  jsonCopyValue: '复制值',
  jsonCopyJson: '复制 JSON',
  jsonCopyPath: '复制路径',
  jsonCopyPretty: '复制格式化 JSON',
  jsonCopyCompact: '复制紧凑 JSON',
  jsonCopyFailed: '复制失败',
  jsonCollapse: '折叠节点',
  jsonExpand: '展开节点',
  jsonTreeLabel: 'JSON 数据',
  sideChatCrashed: '侧边聊天面板崩溃了：',
  forkErrorTitle: '无法创建侧边聊天',
  forkErrorHint: '主会话需要至少一轮已完成的对话才能 fork。点击标签上的 × 可关闭此标签页。',
  missingTitle: '会话已不存在',
  missingDetail: '此侧边聊天的会话已被移除，无法恢复。',
  missingHint: '点击标签上的 × 关闭此标签页。',
  preparing: '正在准备侧边聊天…',
  annotationStorageMemory: '当前仅保存在本页，刷新可能丢失修改。',
  historyFailed: '会话历史加载失败，可关闭后重新打开此标签页。',
  emptyTitle: '侧边聊天',
  emptyText: '侧边聊天从当前会话 fork，独立演进；关闭标签页后消失。',
  thinking: '思考过程',
  writing: '正在输出…',
  stopped: '已停止',
  toolLabel: '工具',
  failed: '失败',
  todoTitle: '任务',
  todoDone: '{n} 已完成',
  todoDoing: '{n} 进行中',
  todoPending: '{n} 待处理',
  running: '执行中…',
  inputPlaceholder: '输入消息…（Enter 发送，Shift+Enter 换行）',
  modelLabel: '模型：{name}',
  modelSwitchTitle: '切换侧边聊天模型',
  permChipTitle: '权限模式',
  permFullAccess: 'Full access',
  pendingNotice: '⚠ 侧边会话有审批/提问待处理——点击跳到主视图处理',
  writeNotice: '侧边会话与主会话同权限，可以修改文件（当前模式见输入框旁 chip）',
  pendingApprovalTitle: '等待审批',
  pendingApprovalDesc: '工具 {name} 请求越权执行',
  pendingReject: '拒绝',
  pendingAllowOnce: '允许一次',
  pendingQuestionTitle: '提问',
  pendingPlanReview: '计划审批',
  pendingQuestionSubmit: '提交回答',
  pendingQuestionCancel: '取消',
  pendingCustomPlaceholder: '自定义回答…',
  modelFollowsMain: '跟随主会话',
  stopReply: '停止',
  sideChatDone: '「{title}」回复完成',
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
  cmdReopen: '重开「{title}」',
  closedJustNow: '刚刚关闭',
  closedMinutesAgo: '{n} 分钟前关闭',
  closedHoursAgo: '{n} 小时前关闭',
  closedYesterday: '昨天关闭',
  closedOnDate: '{month}月{day}日关闭',
  closedOnDateYear: '{year}年{month}月{day}日关闭',

  addToConversation: '添加到对话',
  askInSideChat: '在侧边聊天中提问',
  toolbarAria: '划选注释',
  notePlaceholder: '这里可以写自己的注解…',
  confirmTitle: '确认',
  saveNoteAria: '确认注解',
  editNoteAria: '编辑批注',
  selectedText: '所选文本',
  userComment: '用户评论',
  sideNotePlaceholder: '给侧边聊天写个注解（可空）…',
  sideNoteAria: '侧边聊天注解',
  confirmAskAria: '确认并提问',
  openSideFailed: '打开侧边聊天失败，请重试',
  sideTargetWaiting: '正在等待目标侧边会话，Esc 可取消',
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
  clearAnnotations: '清空注释',
  clearReflows: '清空侧边回流',
  chipNote: '（{note}）',

  headerSide: '侧边',
  headerSideTitle: '打开侧边聊天（从当前会话 fork）',
  hintText: '小技巧：划选回复里的文字，可以加注解或在侧边提问',
  hintClose: '知道了',

  reflowToMain: '带回主对话',
  sendAnnotations: '发送注释',
  reflowFrom: '来自侧边聊天（{title}）：',
  reflowDone: '已加入主对话，尚未发送',
  reflowFailed: '主会话不可达',
  reflowChipOne: '1 条侧边回流',
  reflowChipMany: '{n} 条侧边回流',
  reflowReason: '用户选择从侧边聊天带回主线',
  reflowBubbleLabel: '含侧边回流上下文',
  reflowRemoveTitle: '移除回流',

  termCommandLine: '命令第 {n} 行',
  termSignal: '已终止（{signal}）',
  termExitCode: '退出码 {code}',
  termDone: '完成',
  termNoOutput: '（无输出）',
  termCollapse: '收起',
  termCollapseAria: '收起输出',
  termExpand: '展开全部（隐藏 {n} 行）',
  termExpandAria: '展开全部（隐藏 {n} 行）',

  inheritedLabel: '继承自主会话 · 截至 fork 点 · {n} 条',
  snapshotLabel: '主线进展快照',
  snapshotLabelAt: '主线进展快照 · 截于 {at}',

  collapseAll: '全部折叠',
  expandAll: '全部展开',
  jumpToLatest: '↓ 跳到最新',
  reflowAll: '整段回流',
  reflowAllTitle: '把该侧聊全部问答对带回主会话（chip 可预览/逐条撤）',
  reflowAllDone: '已回流 ✓',
  promote: '保存为正式会话',
  promoteTitle: '把侧边聊天转为会话列表里的正式会话',
  promoteBusy: '请等待回复及待发消息处理完成后再保存',
  promoteDraftBusy: '发送或清除草稿、附件和注释后再保存',
  promoteDone: '已保存为正式会话——已在主视图打开',

  readWindow: '{shown}/{total} 行',
  searchPathsSummary: '{shown}/{total} 个路径',
  searchMatchesSummary: '{shown}/{total} 处匹配 · {files} 个文件',
  searchNoResults: '无结果',
  diffFiles: '{n} 个文件',
  webNoResults: '无结果',
  webSourcesTruncated: '来源列表已截断',
  webContentTruncated: '内容已截断',

  parentStripTitle: '主线会话状态——点击回到主对话',
  parentRunning: '主线：运行中',
  parentPending: '主线：等待处理',
  parentIdle: '主线：空闲',
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
