/**
 * The 「N 条注释」 composer chip (Workitem 02): a `conversation.input.dock`
 * list entry (the official composer-attachment seat; todo dock lives at order
 * 0, the queue strip at 20 — we sit between at 10). The chip counts the
 * session's ACTIVE annotations, expands inline to preview/remove each one,
 * and watches the owner-provided input snapshot for the send edge (draft
 * non-empty → empty) to flip the annotations to 'sent' — the chip then
 * disappears while the badges stay on the message flow.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { IconCloseOutline16, IconListPenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputZone } from '../../context-types.ts'
import { isSendEdge } from './format.ts'
import type { AnnotationStore } from './model.ts'
import { t, useLocaleTick } from '../locales.ts'
import { AnnotateErrorBoundary } from './overlay.tsx'
import css from './annotate.module.css'

/** Props the dock skeleton hands us: the InputZone owner share (point-in-time). */
interface ChipProps {
  readonly session: InputZone['session']
  readonly input: InputZone['input']
}

/** Create the slot component bound to one store instance. */
export function createAnnotationChip(store: AnnotationStore) {
  function AnnotationChip(props: ChipProps): ReactNode {
    useLocaleTick()
    const sessionId = props.session.sessionId
    useSyncExternalStore(
      useCallback((cb: () => void) => store.subscribe(cb), [store]),
      () => store.getSnapshot(),
    )
    const [expanded, setExpanded] = useState(false)

    // 发送沿检测：草稿非空→空 且 伴随机器信号（提交相位/队列增长/running 启
    // 动）——纯「草稿清空」不算发送（用户手动全选删除满足前者，但没有机器信
    // 号，注释不应被误归档为已发送）。
    // owner share 是 point-in-time 快照、由骨架负责重渲染——禁止订阅，只在
    // effect 里比边沿。会话切换不重置：仅当两次渲染属于同一会话时才比较。
    const previous = useRef({
      sessionId,
      draft: props.input.draft,
      phase: props.input.phase,
      queueLen: props.input.queue?.length ?? 0,
      running: props.session.running,
    })
    useEffect(() => {
      const prev = previous.current
      previous.current = {
        sessionId,
        draft: props.input.draft,
        phase: props.input.phase,
        queueLen: props.input.queue?.length ?? 0,
        running: props.session.running,
      }
      if (prev.sessionId !== sessionId) return
      if (store.countActive(sessionId) === 0) return
      if (!isSendEdge(prev.draft, props.input.draft)) return
      const machineSignal = prev.phase !== 'plain'
        || (props.input.queue?.length ?? 0) > prev.queueLen
        || (props.session.running && !prev.running)
      if (!machineSignal) return
      store.markSessionSent(sessionId)
    })

    const active = store.listActive(sessionId)
    if (active.length === 0) return null

    return (
      <div className={css.chipWrap}>
        <button
          type="button"
          className={css.chip}
          aria-expanded={expanded}
          onClick={() => { setExpanded(open => !open) }}
        >
          <IconListPenOutline16 size={12} />
          <span>{t(active.length === 1 ? 'chipOne' : 'chipMany', { n: active.length })}</span>
        </button>
        {expanded && (
          <ul className={css.chipPanel}>
            {active.map(annotation => (
              <li key={annotation.id} className={css.chipRow}>
                <span className={css.chipNumber}>{annotation.number}</span>
                <span className={css.chipText} title={annotation.text}>
                  {annotation.text}
                  {annotation.note !== '' && <span className={css.chipNote}>（{annotation.note}）</span>}
                </span>
                <button
                  type="button"
                  className={css.chipRemove}
                  title={t('removeTitle')}
                  aria-label={t('removeAria', { n: annotation.number })}
                  onClick={() => { store.remove(annotation.id) }}
                >
                  <IconCloseOutline16 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return function AnnotationChipEntry(props: ChipProps): ReactNode {
    return (
      <AnnotateErrorBoundary>
        <AnnotationChip {...props} />
      </AnnotateErrorBoundary>
    )
  }
}
