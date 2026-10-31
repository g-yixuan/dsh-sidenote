import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import { createFoldStore } from '../chat/viewState.ts'
import { IconChevronDownOutline14 } from '../host/icons.ts'
import { t } from '../locales.ts'
import type { SnapshotEntry } from './snapshot.ts'
import type { ContextEntry } from './context.ts'
import { ContextProgress } from './ContextProgress.tsx'
import css from './sidechat.module.css'

export interface InheritedContextData {
  sessionId: string
  boundarySeq?: number
  contextPending?: boolean
  history: readonly ContextEntry[]
  loadImage?: (attachment: unknown) => Promise<string>
  loadProgressImage?: (attachment: unknown) => Promise<string>
  progress?: { entries: SnapshotEntry[]; takenAt?: string | null }
  loadContext?: () => Promise<void>
  loadError?: string
}

/** Side and saved sessions share the same reader and its local scroll owner. */
export function InheritedContext({ context }: { context: InheritedContextData }) {
  const fold = useMemo(() => createFoldStore(`dsh-sidenote:fold:v1:${context.sessionId}`), [context.sessionId])
  useSyncExternalStore(fold.subscribe, fold.getSnapshot)
  const expanded = fold.isOpen('inherited')
  const contextId = useId()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!expanded) return
    let active = true
    setLoading(true); setError(undefined)
    void Promise.resolve(context.loadContext?.()).then(() => { if (active) setLoading(false) }, reason => {
      if (active) { setLoading(false); setError(String(reason instanceof Error ? reason.message : reason)) }
    })
    return () => { active = false }
  }, [expanded, context.loadContext, attempt])
  return <div className={css.mainContext}>
    <div className={css.contextColumn} data-sidenote-main-context>
      <button type="button" className={css.historyToggle} aria-expanded={expanded} aria-controls={contextId} onClick={() => { fold.toggle('inherited') }}>
        <IconChevronDownOutline14 size={12} className={expanded ? css.contextChevronOpen : css.contextChevron} />
        <span>{t('mainContext')}</span><span className={css.contextHint}>{context.contextPending ? t('contextAtSend') : context.progress?.takenAt ? t('contextAsOf', { time: context.progress.takenAt }) : t('contextInherited')}</span>
      </button>
      {!expanded && context.loadError && <div className={css.errorRow} role="alert">{context.loadError}<button type="button" className={css.nativeAction} onClick={() => { fold.toggle('inherited') }}>{t('contextRetry')}</button></div>}
      {expanded && <ContextProgress id={contextId} history={context.history} entries={context.progress?.entries ?? []} live={context.contextPending === true} loading={loading} error={error ?? (loading ? undefined : context.loadError)} onRetry={() => { setAttempt(value => value + 1) }} loadImage={context.loadImage} loadProgressImage={context.loadProgressImage} />}
    </div>
  </div>
}
