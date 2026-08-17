/**
 * The annotation overlay (Workitem 02): an independent React root appended to
 * `document.body` (marked `data-dsh-side-chat` so the selection listener
 * excludes it) rendering three fixed-position layers over the conversation:
 *
 * - the selection toolbar (添加到对话 / 在侧边聊天中提问),
 * - the numbered badge layer (锚定在选区矩形右缘、选区首行高度) plus the
 *   激活态高亮 (editor open only — 关闭后高亮消退只留角标),
 * - the annotation editor popover (新建态 ✓ / 重开态 🗑 取消 保存).
 *
 * Every layer is pointer-safe (toolbar buttons preventDefault their mousedown
 * so the selection survives until the click commits) and failure-safe (an
 * error boundary around the tree; layout math is wrapped in anchor.ts).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Component } from 'react'
import type { ReactNode } from 'react'
import { IconCheckOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../../context-types.ts'
import { sideChatBridge } from '../bridge.ts'
import { badgeAnchorOf, highlightRectsOf, resolveRange } from './anchor.ts'
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

/** 「在侧边聊天中提问」的注解收集态：先弹编辑器（与「添加到对话」一致，
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
    console.error('[dsh-side-chat] annotate overlay crashed:', error)
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
  const selectionState = useSyncExternalStore(
    (cb: () => void) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  )
  // Store version (bumped per mutation) and session list drive re-renders.
  useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getSnapshot(),
  )
  const sessionList = useSyncExternalStore(
    (cb: () => void) => ctx.sessions.list.subscribe(cb),
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
    const bump = (): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        setGeometryTick(tick => tick + 1)
      })
    }
    const observer = new MutationObserver(bump)
    try {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    } catch {
      // document.body missing (pre-mount teardown) — badges just stay put.
    }
    window.addEventListener('resize', bump)
    document.addEventListener('scroll', bump, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', bump)
      document.removeEventListener('scroll', bump, true)
      if (raf !== 0) window.cancelAnimationFrame(raf)
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

  const commitSideDraft = (note: string): void => {
    if (sideDraft === null) return
    sideChatBridge.current?.askInSideChat(
      sideDraft.snapshot.sessionId,
      buildSideChatQuote(sideDraft.snapshot.text, note),
    )
    setSideDraft(null)
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

/** 「在侧边聊天中提问」的注解编辑器（新建态同构：输入框 + ✓，允许空注解）。 */
function SideChatNoteEditor(props: {
  x: number
  y: number
  onSave: (note: string) => void
  onCancel: () => void
}): ReactNode {
  const [note, setNote] = useState('')
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
      if (event.target instanceof Element && event.target.closest('[data-dsh-side-chat]') !== null) return
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
  const save = (): void => { props.onSave(note) }

  return (
    <div ref={rootRef} className={css.editorNew} style={{ left, top, width }}>
      <input
        className={css.editorInput}
        value={note}
        placeholder="给侧边聊天写个注解（可空）…"
        aria-label="侧边聊天注解"
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
        title="确认"
        aria-label="确认并提问"
        onClick={save}
      >
        <IconCheckOutline16 size={14} />
      </button>
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
  const { rect } = props.snapshot
  const left = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2))
  const top = Math.max(4, rect.top - 10)
  return (
    <div
      className={css.toolbar}
      style={{ left, top }}
      role="toolbar"
      aria-label="划选注释"
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
        添加到对话
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
          在侧边聊天中提问
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
    const point = { x: anchor.right, y: anchor.centerY }
    badges.push(
      <button
        key={annotation.id}
        type="button"
        className={css.badge}
        style={{ left: point.x + 6, top: point.y }}
        title={annotation.note === '' ? annotation.text : `${annotation.text}\n注解：${annotation.note}`}
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
      if (event.target instanceof Element && event.target.closest('[data-dsh-side-chat]') !== null) return
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
          placeholder="这里可以写自己的注解…"
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
          title="确认"
          aria-label="确认注解"
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
        placeholder="这里可以写自己的注解…"
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
          title="删除注释"
          aria-label="删除注释"
          onClick={props.onDelete}
        >
          <IconTrashOutline16 size={14} />
        </button>
        <span className={css.editorSpacer} />
        <button type="button" className={css.cancelButton} onClick={props.onCancel}>取消</button>
        <button type="button" className={css.saveButton} onClick={save}>保存</button>
      </div>
    </div>
  )
}
