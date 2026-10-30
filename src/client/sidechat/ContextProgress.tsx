import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutline14, IconCodeOutline16, IconThinkOutline16 } from '../host/icons.ts'
import { t } from '../locales.ts'
import { conversationViewOf } from '../host/dom.ts'
import { reasoningDisplayText } from '../host/reasoning.ts'
import { SentContext, sentContextRule } from '../annotations/NativeUserContext.tsx'
import type { SnapshotEntry } from './snapshot.ts'
import type { ContextEntry } from './context.ts'
import css from './sidechat.module.css'

function ContextImage({ attachment, load }: { attachment: unknown; load?: (attachment: unknown) => Promise<string> }) {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    if (load) void load(attachment).then(value => { if (active) setUrl(value) }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [attachment, load])
  return url ? <a href={url} target="_blank" rel="noreferrer"><img className={css.contextImage} src={url} alt={t('imagePlaceholder')} /></a>
    : <span className={css.contextHint}>{t(failed ? 'contextImageFailed' : 'imagePlaceholder')}</span>
}

const ProgressEntry = memo(function ProgressEntry({ entry, live, loadImage }: { entry: SnapshotEntry & Partial<ContextEntry>; live: boolean; loadImage?: (attachment: unknown) => Promise<string> }) {
  const protocol = entry.kind === 'request' ? sentContextRule.match(entry.text, 0) : undefined
  const process = entry.kind === 'thinking' || entry.kind === 'tool'
  const labels = useMemo(() => ({ code: { copyLabel: t('contextCopy'), copiedLabel: t('contextCopied') }, footnotes: t('contextFootnotes') }), [t('contextCopy')])
  const text = entry.kind === 'thinking' ? reasoningDisplayText(entry.text) : entry.text
  if (entry.kind === 'thinking' && text !== entry.text && text.trim() === '') return null
  const unfinished = entry.unfinished || entry.kind === 'streaming'
  const status = unfinished ? <span className={css.contextHint}>{t(live ? 'contextstreaming' : 'contextUnfinished')}</span> : null
  if (entry.kind === 'request') return <div className={css.contextUserRow} data-context-kind="request" data-context-key={entry.key}>
    {entry.images?.map((image, index) => <ContextImage key={index} attachment={image} load={loadImage} />)}
    {(entry.text || protocol) && <div className={css.contextBubble}>{protocol && <SentContext protocol={protocol.data} />}<span>{entry.text.slice(protocol?.end ?? 0)}</span></div>}
  </div>
  if (!process) return <div className={css.progressEntry} data-context-kind={entry.kind} data-context-key={entry.key}>
    {entry.kind === 'checkpoint' && <span className={css.contextHint}>{t('contextcheckpoint')}</span>}
    <div data-sidenote-quote-body={entry.messageKey ? '' : undefined} data-sidenote-message-role={entry.messageKey ? 'assistant' : undefined} data-sidenote-message-key={entry.messageKey} data-sidenote-streaming={live && unfinished ? 'true' : 'false'}>
      <MarkdownText text={entry.text} streaming={live && unfinished} labels={labels} />
    </div>
    {status}
    {entry.images?.map((image, index) => <ContextImage key={index} attachment={image} load={loadImage} />)}
  </div>
  return <details className={css.progressProcess} data-context-kind={entry.kind} data-context-key={entry.key}>
    <summary>{entry.kind === 'tool' ? <IconCodeOutline16 size={14} /> : <IconThinkOutline16 size={14} />}
      <span>{entry.kind === 'tool' ? entry.toolName : t('contextthinking')}</span><span className={css.progressPreview}>{text}</span>{status}
      <IconChevronDownOutline14 size={12} />
    </summary>
    <div className={css.progressDetail}>{entry.kind === 'thinking' ? <MarkdownText text={text} streaming={live && unfinished} labels={labels} /> : text}</div>
  </details>
})

/** This region alone owns context scrolling. It never moves the native side
 * conversation, and it mounts even before that conversation has any messages. */
export function ContextProgress({ id, history, entries, live, loading, error, onRetry, loadImage, loadProgressImage }: {
  id: string; history: readonly ContextEntry[]; entries: readonly SnapshotEntry[]; live: boolean
  loading: boolean; error?: string; onRetry: () => void; loadImage?: (attachment: unknown) => Promise<string>; loadProgressImage?: (attachment: unknown) => Promise<string>
}) {
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [following, setFollowing] = useState(true)
  const updateAffordance = () => {
    const element = root.current
    setFollowing(!element || element.scrollHeight - element.scrollTop - element.clientHeight < 16)
  }
  const pause = () => { follow.current = false; updateAffordance() }
  const toLatest = () => {
    follow.current = true; setFollowing(true)
    if (root.current) { root.current.scrollTop = root.current.scrollHeight; root.current.focus({ preventScroll: true }) }
  }
  useLayoutEffect(() => {
    if (follow.current && root.current) root.current.scrollTop = root.current.scrollHeight
    updateAffordance()
  }, [history, entries, loading])
  useEffect(() => {
    const view = root.current ? conversationViewOf(root.current) : undefined
    const newerIntent = (event: Event) => { if (!root.current?.contains(event.target as Node)) pause() }
    for (const type of ['wheel', 'pointerdown', 'keydown']) view?.addEventListener(type, newerIntent, true)
    return () => { for (const type of ['wheel', 'pointerdown', 'keydown']) view?.removeEventListener(type, newerIntent, true) }
  }, [])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (follow.current && root.current) root.current.scrollTop = root.current.scrollHeight
      updateAffordance()
    })
    if (content.current) observer.observe(content.current)
    return () => { observer.disconnect() }
  }, [])
  return <section id={id} className={css.progress} aria-label={t('mainContext')} data-sidenote-context-section>
    <div ref={root} className={css.progressEntries} data-sidenote-context-progress tabIndex={0} role="region" aria-label={t('mainContext')}
      onWheel={event => { if (event.deltaY < 0) pause() }}
      onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause() }}
      onPointerDown={event => { if ((event.target as Element).closest('summary')) pause() }}
      onScroll={event => {
        const element = event.currentTarget
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 16
        setFollowing(follow.current)
      }}>
      <div ref={content} className={css.progressContent}>
        <div data-sidenote-context-history>{history.map(entry => <ProgressEntry key={entry.key} entry={entry} live={false} loadImage={loadImage} />)}</div>
        {entries.length > 0 && <div data-sidenote-context-increment>
          {entries.map((entry, index) => <ProgressEntry key={`progress:${index}:${entry.kind}`} entry={entry} live={live} loadImage={loadProgressImage ?? loadImage} />)}
        </div>}
        {loading && <div className={css.contextHint} role="status">{t('contextLoading')}</div>}
        {error && <div className={css.stateDetail} role="alert">{error} <button type="button" className={css.nativeAction} onClick={onRetry}>{t('contextRetry')}</button></div>}
        {!loading && !error && history.length === 0 && entries.length === 0 && <div className={css.contextHint}>{t('contextEmpty')}</div>}
      </div>
    </div>
    {!following && <button type="button" className={css.progressLatest} onClick={toLatest}><IconChevronDownOutline14 size={12} />{t('contextLatest')}</button>}
  </section>
}
