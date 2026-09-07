/**
 * 工具卡映射层（L0 纯逻辑）：宿主快照下发的渲染意图（callView/resultView
 * card union）→ 本插件自己的工具卡视图模型（ToolCardModel）。
 *
 * 为什么不直接在视图层 switch 宿主 union：
 * 1. 三层判别（card → shape/kind → null 缺省）收敛在这一处，视图层只认
 *    ToolCardModel（窄栏渲染不需要关心宿主的判别结构）；
 * 2. card 集合官方明示可扩展（"a new arm is a union edit plus a consumer
 *    branch"）——未知值必须 default 降级 generic + warn-once（T3 纪律），
 *     warn 只打一次防刷屏；
 * 3. 测试在 node 跑纯函数，不碰 React。
 *
 * 类型来源：import type 自 api-remotes（client-runtime 同源的那份影子；
 * tools/connection/api-remotes 三处会漂移，钉这一个——architecture.md 第六节）。
 */
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * 叶子类型不从 dsh-tools 直接拉（api-remotes 未再导出；三处影子会漂移）——
 * 结构派生自已钉的联合，漂移时 typecheck 在这里变红而不是在运行时空字段。
 */
type GenericCallView = Extract<ToolCallView, { card: 'generic' }>
export type ToolCallKind = NonNullable<GenericCallView['kind']>
type DiffCallView = Extract<ToolCallView, { card: 'diff' }>
export type FileDiff = DiffCallView['diffs'][number]
export type FileLocation = NonNullable<GenericCallView['locations']>[number]
type WebSearchResultView = Extract<Extract<ToolResultView, { card: 'web' }>, { kind: 'search' }>
type WebFetchResultView = Extract<Extract<ToolResultView, { card: 'web' }>, { kind: 'fetch' }>

/** 归一化工具卡视图模型（视图层唯一消费形状）。 */
export type ToolCardModel =
  | {
      kind: 'generic'
      /** 标题（resultView.title ?? callView.title ?? 工具名兜底）。 */
      title: string
      /** 图标类别（callView.kind，缺省 'other'）。 */
      icon: ToolCallKind
      /** 展开的 salient 输入（string 原样 / object 走 JsonTree）。 */
      rawInput?: unknown
      /** 结果内容（resultView.content 优先，缺省回退原始 content 文本）。 */
      bodyText?: string
      /** 跟随文件列表。 */
      locations?: readonly FileLocation[]
    }
  | {
      kind: 'terminal'
      title: string
      description?: string
      /** 已解析的 cwd（相对路径已按 cwdBase 折成绝对；无 base 时原样）。 */
      cwd?: string
      output?: string
      exitCode?: number
      signal?: string
    }
  | { kind: 'diff'; title: string; diffs: readonly FileDiff[]; locations?: readonly FileLocation[] }
  | {
      kind: 'search'
      title: string
      shape: 'matches' | 'paths'
      files?: readonly { path: string; matches: readonly { lineNumber: number; line: string }[] }[]
      paths?: readonly string[]
      truncated: boolean
      total: number
    }
  | {
      kind: 'read'
      title: string
      path: string
      lines: readonly { number: number; text: string }[]
      totalLines: number
      lang?: string
    }
  | {
      kind: 'web'
      title: string
      webKind: 'search' | 'fetch'
      /** search 态：引用源列表。 */
      sources?: readonly { url: string; title?: string; snippet?: string }[]
      /** search 态：provider 答案。 */
      answer?: string
      /** fetch 态：最终 URL / 状态码 / 截断标记。 */
      url?: string
      statusCode?: number
      truncated?: boolean
    }

/** ContentBlock[] → 纯文本（transcript.ts 同款的极简版，避免互依赖）。 */
function blocksText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown } | null
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/** 未知 card 值的 warn-once 登记（T3 纪律：降级不静默）。 */
const warnedCards = new Set<string>()
function warnUnknownCard(value: string): void {
  if (warnedCards.has(value)) return
  warnedCards.add(value)
  console.warn(`[dsh-sidenote] 未知工具卡种类 "${value}"——降级为 generic 卡（宿主可能扩展了 card union）`)
}

/** 相对 cwd 按会话工作区折成绝对路径（UI bridge 责任——presentation 注释明文）。 */
function resolveCwd(cwd: string | undefined, cwdBase: string | undefined): string | undefined {
  if (cwd === undefined) return cwdBase
  if (cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd)) return cwd
  if (cwdBase === undefined) return cwd
  return `${cwdBase.replace(/\/+$/, '')}/${cwd}`
}

export interface CardModelInput {
  /** 工具名兜底（callView 缺失时的标题）。 */
  toolName: string
  callView: ToolCallView | null | undefined
  resultView: ToolResultView | null | undefined
  /** 原始结果正文（resultView 缺 content 时的回退）。 */
  rawText?: string
  /** 会话工作区（相对 cwd 解析基准）。 */
  cwdBase?: string
}

/**
 * callView + resultView → 一张卡的视图模型。三层判别全在这里；
 * 结果态优先（title 等字段 result 覆盖 call），缺省逐字段回退。
 */
export function cardModelOf(input: CardModelInput): ToolCardModel {
  const { callView, resultView } = input
  const call = callView ?? undefined
  const result = resultView ?? undefined

  // 结果态的卡种优先（resultView 存在即代表完成态形态）；否则看 call。
  const card = result?.card ?? call?.card ?? 'generic'

  switch (card) {
    case 'terminal': {
      const rc = result?.card === 'terminal' ? result : undefined
      const cc = call?.card === 'terminal' ? call : undefined
      return {
        kind: 'terminal',
        title: rc?.title ?? cc?.title ?? input.toolName,
        ...(cc?.description !== undefined ? { description: cc.description } : {}),
        ...(resolveCwd(cc?.cwd, input.cwdBase) !== undefined ? { cwd: resolveCwd(cc?.cwd, input.cwdBase) } : {}),
        ...(rc?.output !== undefined ? { output: rc.output } : {}),
        ...(rc?.exitCode !== undefined ? { exitCode: rc.exitCode } : {}),
        ...(rc?.signal !== undefined ? { signal: rc.signal } : {}),
      }
    }
    case 'diff': {
      const rc = result?.card === 'diff' ? result : undefined
      const cc = call?.card === 'diff' ? call : undefined
      return {
        kind: 'diff',
        title: rc?.title ?? cc?.title ?? input.toolName,
        diffs: rc?.diffs ?? cc?.diffs ?? [],
        ...(cc?.locations !== undefined ? { locations: cc.locations } : {}),
      }
    }
    case 'search': {
      const rc = result?.card === 'search' ? result : undefined
      if (rc === undefined) {
        // 只有 call 态（搜索的 call 是 generic kind:'search'）——不应到这里，防御。
        return genericModel(input, call, result)
      }
      // 二级判别同样显式：未知 shape 降级 generic（不猜）。
      if (rc.shape === 'matches') {
        return { kind: 'search', title: rc.title ?? call?.title ?? input.toolName, shape: 'matches', files: rc.files, truncated: rc.truncated, total: rc.total }
      }
      if (rc.shape === 'paths') {
        return { kind: 'search', title: rc.title ?? call?.title ?? input.toolName, shape: 'paths', paths: rc.paths, truncated: rc.truncated, total: rc.total }
      }
      warnUnknownCard(`search/${String((rc as { shape?: unknown }).shape)}`)
      return genericModel(input, call, result)
    }
    case 'read': {
      const rc = result?.card === 'read' ? result : undefined
      if (rc === undefined) return genericModel(input, call, result)
      return {
        kind: 'read',
        title: rc.title ?? call?.title ?? input.toolName,
        path: rc.path,
        lines: rc.lines,
        totalLines: rc.totalLines,
        ...(rc.lang !== undefined ? { lang: rc.lang } : {}),
      }
    }
    case 'web': {
      const rc = result?.card === 'web' ? result : undefined
      if (rc === undefined) return genericModel(input, call, result)
      const base = { kind: 'web' as const, title: rc.title ?? call?.title ?? input.toolName }
      if (rc.kind === 'search') {
        const rs: WebSearchResultView = rc
        return { ...base, webKind: 'search' as const, sources: rs.sources, ...(rs.answer !== undefined ? { answer: rs.answer } : {}) }
      }
      if (rc.kind === 'fetch') {
        const rf: WebFetchResultView = rc
        return { ...base, webKind: 'fetch' as const, url: rf.url, statusCode: rf.statusCode, truncated: rf.truncated }
      }
      warnUnknownCard(`web/${String((rc as { kind?: unknown }).kind)}`)
      return genericModel(input, call, result)
    }
    case 'generic':
      return genericModel(input, call, result)
    default:
      warnUnknownCard(String(card))
      return genericModel(input, call, result)
  }
}

function genericModel(
  input: CardModelInput,
  call: ToolCallView | undefined,
  result: ToolResultView | undefined,
): ToolCardModel {
  const gc = call?.card === 'generic' ? call : undefined
  const gr = result?.card === 'generic' ? result : undefined
  return {
    kind: 'generic',
    title: gr?.title ?? gc?.title ?? input.toolName,
    icon: gc?.kind ?? 'other',
    ...(gc?.rawInput !== undefined ? { rawInput: gc.rawInput } : {}),
    bodyText: blocksText(gr?.content) ?? blocksText(gc?.content) ?? input.rawText,
    ...(gc?.locations !== undefined ? { locations: gc.locations } : {}),
  }
}
