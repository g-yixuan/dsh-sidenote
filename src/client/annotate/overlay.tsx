/**
 * The annotation overlay (Workitem 02): an independent React root appended to
 * `document.body` (marked `data-dsh-sidechat` so the selection listener
 * excludes it) rendering three fixed-position layers over the conversation:
 *
 * - the selection toolbar (Add to conversation / Ask in side chat),
 * - the numbered badge layer (锚定在选区矩形右缘、选区首行高度) plus the
 *   激活态高亮 (editor open only — 关闭后高亮消退只留角标),
 * - the annotation editor popover (新建态 ✓ / 重开态 🗑 取消 保存).
 *
 * Every layer is pointer-safe (toolbar buttons preventDefault their mousedown
 * so the selection survives until the click commits) and failure-safe (an
 * error boundary around the tree; layout math is wrapped in anchor.ts).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Component } from 'react'
import type { ReactNode } from 'react'
import { IconCheckOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../../context-types.ts'
import { sideChatBridge } from '../bridge.ts'
import { t, useLocaleTick } from '../locales.ts'
import { badgeAnchorOf, highlightRectsOf, resolveRange, spreadBadgePoint } from './anchor.ts'
import { buildSideChatQuote } from './format.ts'
import type { Annotation, AnnotationStore } from './model.ts'
import type { SelectionController, SelectionSnapshot } from './selection.ts'
import css from './annotate.module.css'

/** Editor state: which annotation is being edited, and where the popover sits. */
interface EditorState {
  readonly annotationId: number
  readonly mode: 'new' | 'edit'
  readonly x: number
  readonly y: number
}

/** 「Ask in side chat」的注解收集态：先弹编辑器（与「Add to conversation」一致，
 *  允许空注解），保存后才经 bridge 注入侧边聊天草稿——不产生主对话注释
 *  （无高亮/角标/chip，两个去向互斥）。 */
interface SideDraftState {
  readonly snapshot: SelectionSnapshot
  readonly x: number
  readonly y: number
}

interface OverlayProps {
  readonly ctx: Context
  readonly store: AnnotationStore
  readonly controller: SelectionController
}

/** Crash guard: a render failure must never take the host page down. */
export class AnnotateErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: unknown): void {
    console.error('[dsh-sidechat] annotate overlay crashed:', error)
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/** Badge anchor of a freshly captured selection (editor placement on create). */
function selectionBadgePoint(snapshot: SelectionSnapshot): { x: number; y: number } {
  const anchor = badgeAnchorOf(snapshot.range)
  if (anchor === null) {
    const rect = snapshot.range.getBoundingClientRect()
    return { x: rect.right, y: rect.top + 10 }
  }
  return { x: anchor.right, y: anchor.centerY }
}

export function AnnotateOverlay(props: OverlayProps): ReactNode {
  return (
    <AnnotateErrorBoundary>
      <AnnotateOverlayInner {...props} />
    </AnnotateErrorBoundary>
  )
}

function AnnotateOverlayInner({ ctx, store, controller }: OverlayProps): ReactNode {
  useLocaleTick()
  const selectionState = useSyncExternalStore(
    useCallback((cb: () => void) => controller.subscribe(cb), [controller]),
    () => controller.getSnapshot(),
  )
  // Store version (bumped per mutation) and session list drive re-renders.
  useSyncExternalStore(
    useCallback((cb: () => void) => store.subscribe(cb), [store]),
    () => store.getSnapshot(),
  )
  const sessionList = useSyncExternalStore(
    useCallback((cb: () => void) => ctx.sessions.list.subscribe(cb), [ctx]),
    () => ctx.sessions.list.getSnapshot(),
  )
  const currentSessionId = sessionList.current ?? ''
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [sideDraft, setSideDraft] = useState<SideDraftState | null>(null)
  // Bumped by scroll/resize/DOM mutation so badge/highlight geometry follows.
  const [, setGeometryTick] = useState(0)
  const rangeCache = useRef(new Map<number, Range>())

  useEffect(() => {
    let raf = 0
    let debounce = 0
    const bumpNow = (): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        setGeometryTick(tick => tick + 1)
      })
    }
    // MutationObserver 挂在整棵 document 上：宿主页面的周期更新（相对时间等）
    // 会持续触发——按 100ms 尾沿去抖，否则角标层每帧重渲、按钮永远「不稳定」
    // （真实点击与 Playwright 的稳定性判定都会受影响）。
    const bumpDebounced = (): void => {
      if (debounce !== 0) window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        debounce = 0
        bumpNow()
      }, 100)
    }
    const observer = new MutationObserver(bumpDebounced)
    try {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    } catch {
      // document.body missing (pre-mount teardown) — badges just stay put.
    }
    window.addEventListener('resize', bumpNow)
    document.addEventListener('scroll', bumpNow, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', bumpNow)
      document.removeEventListener('scroll', bumpNow, true)
      if (raf !== 0) window.cancelAnimationFrame(raf)
      if (debounce !== 0) window.clearTimeout(debounce)
    }
  }, [])

  const selection = selectionState.selection

  const addToConversation = (snapshot: SelectionSnapshot): void => {
    const anchor = selectionBadgePoint(snapshot)
    const annotation = store.add({
      sessionId: snapshot.sessionId,
      anchorKey: snapshot.anchorKey,
      text: snapshot.text,
      anchorText: snapshot.anchorText,
      occurrence: snapshot.occurrence,
      note: '',
    })
    const cached = snapshot.range.cloneRange()
    rangeCache.current.set(annotation.id, cached)
    setEditor({ annotationId: annotation.id, mode: 'new', x: anchor.x, y: anchor.y })
    controller.clear()
    window.getSelection()?.removeAllRanges()
  }

  const askInSideChat = (snapshot: SelectionSnapshot): void => {
    // WI-03 联动：先弹注解编辑器收集注解（可空），保存后经 bridge 注入侧边
    // 聊天草稿；本路径不产生主对话注释（无高亮/角标/chip）。
    const anchor = selectionBadgePoint(snapshot)
    setSideDraft({ snapshot, x: anchor.x, y: anchor.y })
    controller.clear()
    window.getSelection()?.removeAllRanges()
  }

  const commitSideDraft = (note: string): boolean => {
    if (sideDraft === null) return false
    const ok = sideChatBridge.current?.askInSideChat(
      sideDraft.snapshot.sessionId,
      buildSideChatQuote(sideDraft.snapshot.text, note),
    ) === true
    if (ok) setSideDraft(null)
    return ok
  }

  const reopenEditor = (annotation: Annotation, point: { x: number; y: number }): void => {
    setEditor({ annotationId: annotation.id, mode: 'edit', x: point.x, y: point.y })
  }

  const closeEditor = (): void => setEditor(null)

  const editingAnnotation = editor === null ? undefined : store.get(editor.annotationId)

  return (
    <>
      {selection !== null && editor === null && sideDraft === null && (
        <SelectionToolbar
          snapshot={selection}
          sideChatAvailable={sideChatBridge.current !== null}
          onAdd={() => { addToConversation(selection) }}
          onAsk={() => { askInSideChat(selection) }}
        />
      )}
      <BadgeLayer
        store={store}
        sessionId={currentSessionId}
        cache={rangeCache.current}
        editingId={editor?.annotationId ?? null}
        onOpen={reopenEditor}
      />
      {editingAnnotation !== undefined && editor !== null && (
        <AnnotationEditor
          annotation={editingAnnotation}
          mode={editor.mode}
          x={editor.x}
          y={editor.y}
          onSave={(note) => {
            store.setNote(editingAnnotation.id, note)
            closeEditor()
          }}
          onDelete={() => {
            store.remove(editingAnnotation.id)
            rangeCache.current.delete(editingAnnotation.id)
            closeEditor()
          }}
          onCancel={() => {
            // 新建态取消 = 放弃整条注释;重开态取消 = 保留原注解。
            if (editor.mode === 'new') {
              store.remove(editingAnnotation.id)
              rangeCache.current.delete(editingAnnotation.id)
            }
            closeEditor()
          }}
        />
      )}
      {sideDraft !== null && (
        <SideChatNoteEditor
          x={sideDraft.x}
          y={sideDraft.y}
          onSave={commitSideDraft}
          onCancel={() => { setSideDraft(null) }}
        />
      )}
    </>
  )
}

/** 「Ask in side chat」的注解编辑器（新建态同构：输入框 + ✓，允许空注解）。
 *  bridge 失败时不关编辑器、给出内联错误——用户写好的注解不丢。 */
function SideChatNoteEditor(props: {
  x: number
  y: number
  onSave: (note: string) => boolean
  onCancel: () => void
}): ReactNode {
  useLocaleTick()
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onCancel()
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root === null || !(event.target instanceof Node)) return
      if (root.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest('[data-dsh-sidechat]') !== null) return
      props.onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const width = 320
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, props.x + 16))
  const top = Math.max(8, Math.min(window.innerHeight - 120, props.y - 20))
  const save = (): void => {
    // 失败保持打开并提示（草稿不丢）；成功由父组件关闭。
    setFailed(!props.onSave(note))
  }

  return (
    <div ref={rootRef} className={css.editorNew} style={{ left, top, width }}>
      <input
        className={css.editorInput}
        value={note}
        placeholder={t('sideNotePlaceholder')}
        aria-label={t('sideNoteAria')}
        autoFocus
        onChange={(event) => { setNote(event.target.value); setFailed(false) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          }
        }}
      />
      <button
        type="button"
        className={css.confirmButton}
        title={t('confirmTitle')}
        aria-label={t('confirmAskAria')}
        onClick={save}
      >
        <IconCheckOutline16 size={14} />
      </button>
      {failed && <div className={css.editorError}>{t('openSideFailed')}</div>}
    </div>
  )
}

/** The floating two-button toolbar above a validated selection. */
function SelectionToolbar(props: {
  snapshot: SelectionSnapshot
  sideChatAvailable: boolean
  onAdd: () => void
  onAsk: () => void
}): ReactNode {
  useLocaleTick()
  const { rect } = props.snapshot
  const left = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2))
  const top = Math.max(4, rect.top - 10)
  return (
    <div
      className={css.toolbar}
      style={{ left, top }}
      role="toolbar"
      aria-label={t('toolbarAria')}
    >
      <button
        type="button"
        className={css.toolbarButton}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onAdd()
        }}
      >
        {t('addToConversation')}
      </button>
      {props.sideChatAvailable && (
        <button
          type="button"
          className={css.toolbarButton}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.onAsk()
          }}
        >
          {t('askInSideChat')}
        </button>
      )}
    </div>
  )
}

/** The badge layer (one numbered circle per annotation) + the active highlight. */
function BadgeLayer(props: {
  store: AnnotationStore
  sessionId: string
  cache: Map<number, Range>
  editingId: number | null
  onOpen: (annotation: Annotation, point: { x: number; y: number }) => void
}): ReactNode {
  const annotations = props.sessionId === '' ? [] : props.store.list(props.sessionId)
  const badges: ReactNode[] = []
  const placed: { x: number; y: number }[] = []
  let highlight: ReactNode = null
  for (const annotation of annotations) {
    const range = resolveRange(annotation, props.cache)
    if (range === null) continue
    if (annotation.id === props.editingId) {
      // 高亮仅激活态呈现：编辑器打开时被选文本保持高亮。
      const rects = highlightRectsOf(range)
      highlight = rects.map((rect, index) => (
        <div
          key={`hl-${index}`}
          className={css.highlight}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))
    }
    const anchor = badgeAnchorOf(range)
    if (anchor === null) continue
    // 锚点滚出视口的角标不渲染（fixed 定位否则会漂浮在无关内容上方）。
    if (anchor.centerY < 0 || anchor.centerY > window.innerHeight || anchor.right < 0 || anchor.right > window.innerWidth) continue
    // 同一选区/相邻行的多个角标会落在同一点位——错开保证每个都可点击。
    const point = spreadBadgePoint({ x: anchor.right, y: anchor.centerY }, placed)
    placed.push(point)
    badges.push(
      <button
        key={annotation.id}
        type="button"
        className={css.badge}
        style={{ left: point.x + 6, top: point.y }}
        title={annotation.note === '' ? annotation.text : `${annotation.text}\n${t('noteLine', { note: annotation.note })}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onOpen(annotation, point)
        }}
      >
        {annotation.number}
      </button>,
    )
  }
  return (
    <>
      {highlight}
      {badges}
    </>
  )
}

/**
 * The annotation editor popover. 新建态: input + ✓ 确认 (允许空注解直接保存;
 * 点击外部/Esc 取消且无显式取消按钮). 重开态: 已有注解 + 🗑 删除 + 取消/保存.
 */
function AnnotationEditor(props: {
  annotation: Annotation
  mode: 'new' | 'edit'
  x: number
  y: number
  onSave: (note: string) => void
  onDelete: () => void
  onCancel: () => void
}): ReactNode {
  useLocaleTick()
  const [note, setNote] = useState(props.annotation.note)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onCancel()
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root === null || !(event.target instanceof Node)) return
      if (root.contains(event.target)) return
      // 本插件自身的 DOM（角标/工具条）不算「外部」：点击角标由它自己的
      // click 处理器接管编辑器，不能先被外部点击取消掉。
      if (event.target instanceof Element && event.target.closest('[data-dsh-sidechat]') !== null) return
      props.onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const width = props.mode === 'new' ? 320 : 340
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, props.x + 16))
  const top = Math.max(8, Math.min(window.innerHeight - 120, props.y - 20))

  const save = (): void => { props.onSave(note) }

  if (props.mode === 'new') {
    return (
      <div ref={rootRef} className={css.editorNew} style={{ left, top, width }}>
        <input
          className={css.editorInput}
          value={note}
          placeholder={t('notePlaceholder')}
          autoFocus
          onChange={(event) => { setNote(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            }
          }}
        />
        <button
          type="button"
          className={css.confirmButton}
          title={t('confirmTitle')}
          aria-label={t('saveNoteAria')}
          onClick={save}
        >
          <IconCheckOutline16 size={14} />
        </button>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={css.editorEdit} style={{ left, top, width }}>
      <textarea
        className={css.editorTextarea}
        value={note}
        placeholder={t('notePlaceholder')}
        rows={3}
        autoFocus
        onChange={(event) => { setNote(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            save()
          }
        }}
      />
      <div className={css.editorFooter}>
        <button
          type="button"
          className={css.deleteButton}
          title={t('deleteNote')}
          aria-label={t('deleteNote')}
          onClick={props.onDelete}
        >
          <IconTrashOutline16 size={14} />
        </button>
        <span className={css.editorSpacer} />
        <button type="button" className={css.cancelButton} onClick={props.onCancel}>{t('cancel')}</button>
        <button type="button" className={css.saveButton} onClick={save}>{t('save')}</button>
      </div>
    </div>
  )
}
