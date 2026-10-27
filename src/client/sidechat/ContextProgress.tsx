import { useLayoutEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14, IconCodeOutline16, IconThinkOutline16 } from '../host/icons.ts'
import { t } from '../locales.ts'
import type { SnapshotEntry } from './snapshot.ts'
import css from './sidechat.module.css'

function ProgressEntry({ entry }: { entry: SnapshotEntry }) {
  const process = entry.kind === 'thinking' || entry.kind === 'tool'
  const label = entry.kind === 'tool' ? entry.toolName : t(`context${entry.kind}`)
  if (!process) return <div className={css.progressEntry} data-context-kind={entry.kind}>
    <span className={css.contextHint}>{label}</span><div>{entry.text}</div>
  </div>
  return <details className={css.progressProcess} data-context-kind={entry.kind}>
    <summary>{entry.kind === 'tool' ? <IconCodeOutline16 size={14} /> : <IconThinkOutline16 size={14} />}
      <span>{label}</span>{entry.kind === 'thinking' && <span className={css.progressPreview}>{entry.text}</span>}
      <IconChevronDownOutline14 size={12} />
    </summary>
    <div className={css.progressDetail}>{entry.text}</div>
  </details>
}

/** Follow live updates only while the reader stays at the bottom. This is a
 * bounded preview, so following it never scrolls the side conversation itself. */
export function ContextProgress({ entries, live }: { entries: readonly SnapshotEntry[]; live: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [following, setFollowing] = useState(true)
  const toLatest = () => {
    follow.current = true; setFollowing(true)
    if (root.current) { root.current.scrollTop = root.current.scrollHeight; root.current.focus({ preventScroll: true }) }
  }
  useLayoutEffect(() => { if (follow.current && root.current) root.current.scrollTop = root.current.scrollHeight }, [entries])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => { if (follow.current && root.current) root.current.scrollTop = root.current.scrollHeight })
    if (root.current) observer.observe(root.current)
    return () => { observer.disconnect() }
  }, [])
  return <section className={css.progress} aria-label={t('contextProgress')} data-sidenote-context-section>
    <div className={css.progressHeading}><span>{t(live ? 'contextLive' : 'contextProgress')}</span>{live && <span className={css.liveDot} aria-hidden="true" />}</div>
    <div ref={root} className={css.progressEntries} data-sidenote-context-progress tabIndex={0} role="region" aria-label={t('contextProgress')}
      onWheel={event => { if (event.deltaY < 0) { follow.current = false; setFollowing(false) } }}
      onScroll={event => {
        const element = event.currentTarget
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 16
        setFollowing(follow.current)
      }}>
      {entries.map((entry, index) => <ProgressEntry key={index} entry={entry} />)}
    </div>
    {!following && <button type="button" className={css.progressLatest} onClick={toLatest}><IconChevronDownOutline14 size={12} />{t('contextLatest')}</button>}
  </section>
}
