/**
 * 侧边面板的消息行家族（L2 视图）：MessageList/MessageRow/ReflowButton/
 * EmptyState/StateScreen。自 SideChatPanel.tsx 拆出（WI-00 预算纪律：
 * 面板壳只留编排）。渲染规则：MessageRow 全族 memo（字段值比较器）。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconCheckOutline16, IconNewChatOutline16, IconShareOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatMessage } from '../chat/transcript.ts'
import { partitionInherited } from '../chat/transcript.ts'
import { ToolCard } from '../chat/ToolCard.tsx'
import { ReasoningRow } from '../chat/ReasoningRow.tsx'
import { FoldCard } from '../chat/FoldCard.tsx'
import type { FoldStore } from '../chat/viewState.ts'
import { flattenReflowContent, splitProtocolPrefix } from '../annotate/format.ts'
import { markdownTextProps } from '../host/markdown.ts'
import type { ReflowStore } from '../reflow.ts'
import { pairQuestions } from './model.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

/** 空状态：💬 类图标 + 标题 + fork 语义文案（形态规格）。 */
export function EmptyState() {
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
export function StateScreen(props: { title: string; detail?: string; hint?: string }) {
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

export function MessageList({ messages, fold, boundarySeq, reflow, parentSessionId, sideTitle }: {
  messages: readonly ChatMessage[]
  fold: FoldStore
  boundarySeq: number | undefined
  reflow: ReflowStore
  parentSessionId: string | undefined
  sideTitle: string
}) {
  // 问答成对：每条 assistant 消息配对它在回答的用户提问（回流时带上）。
  const questions = useMemo(() => pairQuestions(messages), [messages])
  // D1：fork 继承区折叠为指示卡（默认折叠=密度默认态；展开态在同一张卡里，
  // 内容走同一套 MessageRow——材质同源）。继承区默认不挂载（长 fork 历史的
  // 性能护栏）。
  const { inherited, fresh } = useMemo(() => partitionInherited(messages, boundarySeq), [messages, boundarySeq])
  const renderRow = (message: ChatMessage) => (
    <MessageRow key={message.key} message={message} question={questions.get(message.key)} fold={fold} reflow={reflow} parentSessionId={parentSessionId} sideTitle={sideTitle} />
  )
  // P1-4 密度管理：≥2 个可折叠项时出现「全部折叠/展开」开关（FoldCard/工具卡/
  // 思考块全部折叠态外置在 fold store，一键收敛长工具流）。
  const foldableKeys = useMemo(() => {
    const keys: string[] = []
    if (inherited.length > 0) keys.push('inherited')
    for (const m of messages) {
      if (m.card !== undefined) keys.push(m.key)
      if (m.reasoning !== undefined && m.reasoning !== '') keys.push(`${m.key}:thinking`)
    }
    return keys
  }, [messages, inherited.length])
  useSyncExternalStore(useCallback((fn: () => void) => fold.subscribe(fn), [fold]), () => fold.getSnapshot())
  const anyOpen = foldableKeys.some(k => fold.isOpen(k))
  return (
    <div className={css.transcript}>
      {foldableKeys.length >= 2 && (
        <div className={css.densityRow}>
          <button type="button" className={css.densityToggle} onClick={() => { fold.setAll(foldableKeys, !anyOpen) }}>
            {anyOpen ? t('collapseAll') : t('expandAll')}
          </button>
        </div>
      )}
      {inherited.length > 0 && (
        <FoldCard count={inherited.length} rowKey="inherited" fold={fold}>
          {inherited.map(renderRow)}
        </FoldCard>
      )}
      {fresh.map(renderRow)}
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

// MessageRow 全族 memo（C-5 性能纪律）：transcriptOf 每次快照重建消息对象
// （引用必变），比较器按字段值比；store 与回调引用稳定（fold/reflow 单例）。
// 流式增长时只重渲变化的行（长 fork 历史的帧成本随列表长度摊平）。
interface MessageRowProps {
  message: ChatMessage
  question?: string
  fold: FoldStore
  reflow: ReflowStore
  parentSessionId: string | undefined
  sideTitle: string
}

const MessageRow = memo(function MessageRow({ message, question, fold, reflow, parentSessionId, sideTitle }: MessageRowProps) {
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
              <ReasoningRow
                text={message.reasoning}
                rowKey={`${message.key}:thinking`}
                fold={fold}
                {...(message.streaming === true ? { streaming: true } : {})}
              />
            )}
            {message.text !== ''
              ? <MarkdownText {...markdownTextProps(message.text, message.streaming)} />
              : message.streaming === true && <div className={css.streamingHint}>{t('writing')}</div>}
            {message.interrupted === true && <div className={css.noticeRow}>{t('stopped')}</div>}
          </div>
        </div>
      )
    case 'tool':
      // WI-01：渲染意图在场 → 原生级工具卡（DisclosureRow 壳 + 同源叶子块，
      // 默认折叠）；缺省（老快照/无 view）回退纯文本卡。
      if (message.card !== undefined) {
        return (
          <ToolCard
            model={message.card}
            rowKey={message.key}
            fold={fold}
            {...(message.streaming === true ? { streaming: true } : {})}
          />
        )
      }
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
}, rowPropsEqual)

/** memo 比较器：transcriptOf 每次快照重建消息对象（引用必变），按字段值比。 */
function rowPropsEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  if (prev.fold !== next.fold || prev.reflow !== next.reflow) return false
  if (prev.parentSessionId !== next.parentSessionId || prev.sideTitle !== next.sideTitle) return false
  if (prev.question !== next.question) return false
  const a = prev.message
  const b = next.message
  return a === b || (
    a.key === b.key && a.role === b.role && a.text === b.text
    && a.reasoning === b.reasoning && a.streaming === b.streaming
    && a.isError === b.isError && a.interrupted === b.interrupted
    && a.toolName === b.toolName && a.card === b.card && a.seq === b.seq
  )
}
