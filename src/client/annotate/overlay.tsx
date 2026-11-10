/**
 * The annotation overlay (Workitem 02): an independent React root appended to
 * `document.body` (marked `data-dsh-sidenote` so the selection listener
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { IconCheckOutline16, IconCloseOutline16, IconTrashOutline16 } from '../host/icons.ts'
import type { Context } from '../host/contracts.ts'
import { currentSessionIdOf } from '../host/currentSession.ts'
import { focusSideComposer, mountedConversationIds } from '../host/dom.ts'
import { hostDiagnostics } from '../host/probes.ts'
import { insertNativeQuote, probeInput, resolveInput } from '../host/input.ts'
import { sideChatBridge, type SideChatBridge } from '../bridge.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import { badgeAnchorOf, gutterAnchorOf, highlightRectsOf, resolveRanges, spreadBadgePoint, type CachedRange } from './anchor.ts'
import { quoteSourceOf, sourceClip, focusSourceComposer } from '../annotations/source.ts'
import { FirstUseHint } from './hint.tsx'
import type { Annotation, AnnotationStore } from '../annotations/model.ts'
import { resolveSelection, type SelectionController, type SelectionSnapshot } from './selection.ts'
import { AnnotationBoundary } from '../annotations/boundary.tsx'
import type { SidenotePreferences } from '../preferences.ts'
import { SelectionToolbar } from './SelectionToolbar.tsx'
import css from './annotate.module.css'

/** Editor state: which annotation is being edited, and where the popover sits. */
interface EditorState {
  readonly annotationId: number
  readonly mode: 'new' | 'edit'
  readonly x: number
  readonly y: number
  readonly bounds?: Bounds
  readonly targetTitle?: string
}

interface Bounds { left: number; top: number; right: number; bottom: number }

/** 两种新建注解入口共用紧凑的多行输入高度。 */
function useAutoGrowingNote(note: string) {
  const input = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 110)}px`
  }, [note])
  return input
}

/** 「Ask in side chat」的投递草稿：按偏好填写或跳过注解，
 *  经 bridge 等待真实子会话后创建共享注释对象；正文保持干净。 */
interface SideDraftState {
  readonly snapshot: SelectionSnapshot
  readonly x: number
  readonly y: number
  /** 目标侧边聊天 Tab 标题（编辑器上标明「发送至：侧边 N」）。 */
  readonly targetTitle?: string
  readonly abort: AbortController
  readonly target: ReturnType<SideChatBridge['captureTarget']> | undefined
  readonly skipNote: boolean
}

interface OverlayProps {
  readonly ctx: Context
  readonly store: AnnotationStore
  readonly controller: SelectionController
  readonly preferences: SidenotePreferences
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
    <AnnotationBoundary>
      <AnnotateOverlayInner {...props} />
    </AnnotationBoundary>
  )
}

function AnnotateOverlayInner({ ctx, store, controller, preferences }: OverlayProps): ReactNode {
  useLocaleTick()
  const preference = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot)
  const diagnostics = hostDiagnostics(ctx)
  useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot)
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
  // 0.1.7 的 SessionListState 已无 current——双源（list.current / DOM
  // data-conversation-session）。uSES 订阅仍保留，驱动会话切换后的重读。
  void sessionList
  const currentSessionId = currentSessionIdOf(ctx)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [sideDraft, setSideDraft] = useState<SideDraftState | null>(null)
  useEffect(() => () => { sideDraft?.abort.abort() }, [sideDraft])
  const [viewer, setViewer] = useState<{ annotationId: number; x: number; y: number; bounds?: Bounds } | null>(null)
  // Bumped by scroll/resize/DOM mutation so badge/highlight geometry follows.
  const [, setGeometryTick] = useState(0)
  const rangeCache = useRef(new Map<number, CachedRange>())
  const selection = selectionState.selection
  const mountedSessions = mountedConversationIds()
  const hasStoredAnnotations = store.sessions().some(id => store.list(id).length > 0)
  const geometryActive = selection !== null || editor !== null || sideDraft !== null || viewer !== null
    || store.sessions().some(id => mountedSessions.has(id) && store.list(id).some(annotation => (annotation.sourceSessionId ?? id) === id))

  useEffect(() => {
    if (!geometryActive && !hasStoredAnnotations) return
    let mountedKey = [...mountedConversationIds()].sort().join('\n')
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
    const observer = new MutationObserver(records => {
      if (!geometryActive) {
        const next = [...mountedConversationIds()].sort().join('\n')
        if (next !== mountedKey) { mountedKey = next; bumpNow() }
        return
      }
      // Ignore this overlay's own positioning styles; host pane resizing and
      // visibility still invalidate geometry without a feedback loop.
      if (records.every(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-dsh-sidenote]'))) return
      bumpDebounced()
    })
    try {
      observer.observe(document.body, { childList: true, subtree: true,
        ...(geometryActive ? { characterData: true, attributes: true,
          attributeFilter: ['hidden', 'aria-expanded', 'data-sidenote-streaming', 'style', 'class'] } : {}) })
    } catch {
      // document.body missing (pre-mount teardown) — badges just stay put.
    }
    if (geometryActive) {
      window.addEventListener('resize', bumpNow)
      document.addEventListener('scroll', bumpNow, true)
    }
    return () => {
      observer.disconnect()
      if (geometryActive) {
        window.removeEventListener('resize', bumpNow)
        document.removeEventListener('scroll', bumpNow, true)
      }
      if (raf !== 0) window.cancelAnimationFrame(raf)
      if (debounce !== 0) window.clearTimeout(debounce)
    }
  }, [geometryActive, hasStoredAnnotations])

  const nativeQuoteAvailable = selection !== null && !preference.hidden && typeof resolveInput(ctx, selection.sessionId)?.insertQuote === 'function'

  const commitSelection = (action: (snapshot: SelectionSnapshot) => void): void => {
    if (!selection) return
    const snapshot = resolveSelection(selection)
    if (snapshot) action(snapshot)
    else controller.clear()
  }

  const addToConversation = (snapshot: SelectionSnapshot): void => {
    const anchor = selectionBadgePoint(snapshot)
    const annotation = store.add({
      sessionId: snapshot.sessionId,
      sourceSessionId: snapshot.sessionId,
      sourceSurface: snapshot.source.surface,
      anchorKey: snapshot.anchorKey,
      text: snapshot.text,
      anchorText: snapshot.anchorText,
      occurrence: snapshot.occurrence,
      anchors: snapshot.anchors,
      note: '',
    })
    rangeCache.current.set(annotation.id, { ranges: snapshot.ranges.map(range => range.cloneRange()), view: snapshot.source.view })
    setEditor({ annotationId: annotation.id, mode: 'new', x: anchor.x, y: anchor.y, bounds: sourceClip(snapshot.source),
      ...(snapshot.source.surface === 'side' ? { targetTitle: snapshot.source.view.dataset.sidenoteViewTitle } : {}) })
    controller.clear()
    window.getSelection()?.removeAllRanges()
  }

  const askInSideChat = (snapshot: SelectionSnapshot): void => {
    // 按偏好收集注解，等选定的实际目标就绪后递交共享对象。
    const anchor = selectionBadgePoint(snapshot)
    const target = sideChatBridge.current?.captureTarget(snapshot.sessionId)
    const targetTitle = target?.title
    setSideDraft({ snapshot, x: anchor.x, y: anchor.y, abort: new AbortController(), target, skipNote: !preference.showSideChatNote,
      ...(targetTitle !== undefined ? { targetTitle } : {}) })
    controller.clear()
    window.getSelection()?.removeAllRanges()
  }

  const commitSideDraft = async (note: string): Promise<boolean> => {
    if (sideDraft === null) return false
    if (sideDraft.target === undefined) return false
    try {
      const target = await sideDraft.target.resolve(sideDraft.abort.signal)
      if (sideDraft.abort.signal.aborted || currentSessionIdOf(ctx) !== sideDraft.snapshot.sessionId || !target.isOpen()) return false
      const snapshot = sideDraft.snapshot
      const annotation = store.add({
        sessionId: target.childId, sourceSessionId: snapshot.sessionId, sourceSurface: 'main',
        anchorKey: snapshot.anchorKey, text: snapshot.text, anchorText: snapshot.anchorText,
        occurrence: snapshot.occurrence, anchors: snapshot.anchors, note,
      })
      rangeCache.current.set(annotation.id, { ranges: snapshot.ranges.map(range => range.cloneRange()), view: snapshot.source.view })
      setSideDraft(current => current === sideDraft ? null : current)
      if (sideDraft.skipNote) {
        const view = [...document.querySelectorAll<HTMLElement>('[data-sidenote-chat-session]')]
          .find(element => element.dataset.sidenoteChatSession === target.childId)
        if (view) focusSideComposer(view)
      }
      return true
    } catch { return false }
  }

  // sent 态注释的只读回看卡片（角标灰态点开的落点）。

  const reopenAnnotation = (annotation: Annotation, point: { x: number; y: number; bounds?: Bounds; targetTitle?: string }): void => {
    if (store.getSubmission(annotation.sessionId).pending) return
    if (annotation.state === 'sent') {
      setViewer({ annotationId: annotation.id, ...point })
      return
    }
    setEditor({ annotationId: annotation.id, mode: 'edit', ...point })
  }

  const closeEditor = (): void => setEditor(null)

  const editingAnnotation = editor === null ? undefined : store.get(editor.annotationId)
  const viewingAnnotation = viewer === null ? undefined : store.get(viewer.annotationId)

  return (
    <>
      <FirstUseHint />
      {selection !== null && editor === null && sideDraft === null && viewer === null && (
        <SelectionToolbar
          key={`${selection.sessionId}:${selection.anchorKey}:${selection.anchorText}:${selection.rect.top}:${selection.rect.left}`}
          snapshot={selection}
          onQuote={nativeQuoteAvailable ? () => {
            if (!insertNativeQuote(ctx, selection.sessionId, selection.text)) return false
            controller.clear()
            window.getSelection()?.removeAllRanges()
            return true
          } : undefined}
          addAvailable={selection.source.surface === 'side' || (probeInput(ctx, selection.sessionId).state === 'available' && hostDiagnostics(ctx).getSnapshot().capabilities.some(capability => capability.id === 'dock' && capability.state === 'available'))}
          sideChatAvailable={selection.source.surface === 'main' && sideChatBridge.current !== null}
          onAdd={() => { commitSelection(addToConversation) }}
          onAsk={() => { commitSelection(askInSideChat) }}
        />
      )}
      <BadgeLayer
        store={store}
        sessionId={currentSessionId}
        cache={rangeCache.current}
        editingId={editor?.annotationId ?? viewer?.annotationId ?? null}
        onOpen={reopenAnnotation}
      />
      {editingAnnotation !== undefined && editor !== null && (
        <AnnotationEditor
          key={`${editor.annotationId}:${editor.mode}`}
          annotation={editingAnnotation}
          mode={editor.mode}
          x={editor.x}
          y={editor.y}
          bounds={editor.bounds}
          targetTitle={editor.targetTitle}
          onSave={(note) => {
            store.setNote(editingAnnotation.id, note)
            closeEditor()
            const range = rangeCache.current.get(editingAnnotation.id)?.ranges[0]
            const source = range === undefined ? null : quoteSourceOf(range.startContainer, currentSessionId)
            if (source !== null) requestAnimationFrame(() => {
              // Enter leaves focus on body after unmount. An outside click may
              // already have focused another input; preserve that gesture.
              if (document.activeElement === document.body) focusSourceComposer(source)
            })
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
          targetTitle={sideDraft.targetTitle}
          skipNote={sideDraft.skipNote}
          bounds={sourceClip(sideDraft.snapshot.source)}
          onSave={commitSideDraft}
          onCancel={() => { sideDraft.abort.abort(); setSideDraft(null) }}
        />
      )}
      {viewingAnnotation !== undefined && viewer !== null && (
        <SentViewer
          annotation={viewingAnnotation}
          x={viewer.x}
          y={viewer.y}
          bounds={viewer.bounds}
          onClose={() => { setViewer(null) }}
        />
      )}
    </>
  )
}

/** sent 态注释的只读回看卡片（引用 + 注解，无编辑按钮；Esc/外点关闭）。 */
function SentViewer(props: {
  annotation: Annotation
  x: number
  y: number
  bounds?: Bounds
  onClose: () => void
}): ReactNode {
  useLocaleTick()
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onClose()
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root === null || !(event.target instanceof Node)) return
      if (root.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest('[data-dsh-sidenote]') !== null) return
      props.onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const width = popoverWidth(320, props.bounds)
  const left = popoverLeft(props.x, width, props.bounds)
  const top = popoverTop(props.y, 120, props.bounds)

  return (
    <div ref={rootRef} className={css.editorEdit} style={{ left, top, width, maxHeight: (props.bounds?.bottom ?? window.innerHeight) - top - 8, overflowY: 'auto' }}>
      <div className={css.sentCardTitle}>{t('sentCardTitle', { n: props.annotation.number })}</div>
      <div className={css.sentCardQuote}>{props.annotation.text}</div>
      {props.annotation.note !== '' && <div className={css.sentCardNote}>{props.annotation.note}</div>}
    </div>
  )
}


/**
 * 浮层水平落点（W03）：优先锚点右侧；右侧剩余空间不足（贴着展开的
 * better-sidebar 面板时必然不足——角标 gutter 就在消息列右缘）翻到左侧。
 * 右边界取面板左缘（[data-dsh-better-sidebar]，better-sidebar 的根锚点——
 * 仅在装了它的宿主上存在，查不到按视口）。
 */
function popoverWidth(width: number, bounds?: Bounds): number {
  return Math.min(width, Math.max(0, (bounds?.right ?? window.innerWidth) - (bounds?.left ?? 0) - 16))
}

function popoverTop(y: number, height: number, bounds?: Bounds): number {
  return Math.max((bounds?.top ?? 0) + 8, Math.min((bounds?.bottom ?? window.innerHeight) - height, y - 20))
}

function popoverLeft(x: number, width: number, bounds?: Bounds): number {
  const rightBound = bounds?.right ?? window.innerWidth
  const leftBound = bounds?.left ?? 0
  const preferRight = x + 16
  if (preferRight + width + 8 <= rightBound) return preferRight
  return Math.max(leftBound + 8, Math.min(rightBound - width - 8, x - width - 16))
}

/** 「Ask in side chat」的注解编辑器（新建态同构：输入框 + ✓，允许空注解）。
 *  bridge 失败时不关编辑器、给出内联错误——用户写好的注解不丢。 */
export function SideChatNoteEditor(props: {
  x: number
  y: number
  targetTitle?: string
  bounds?: Bounds
  skipNote?: boolean
  onSave: (note: string) => boolean | Promise<boolean>
  onCancel: () => void
}): ReactNode {
  useLocaleTick()
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(!props.skipNote)
  const noteInputRef = useAutoGrowingNote(note)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const latest = useRef({ note, onSave: props.onSave, onCancel: props.onCancel })
  latest.current = { note, onSave: props.onSave, onCancel: props.onCancel }
  const saved = useRef(false)
  const failedRef = useRef(false)
  const cancelled = useRef(false)
  useEffect(() => { cancelled.current = false; return () => { cancelled.current = true } }, [])
  const cancel = (): void => {
    if (cancelled.current) return
    cancelled.current = true
    latest.current.onCancel()
  }
  const save = (outside = false): void => {
    if (saved.current || cancelled.current || (outside && failedRef.current)) return
    // Lock before the bridge runs: focusing its composer must not submit twice.
    saved.current = true
    const finish = (ok: boolean): void => {
      if (cancelled.current) return
      saved.current = ok
      failedRef.current = !ok
      if (!ok) setShowNote(true)
      setFailed(!ok)
      setPending(false)
    }
    try {
      const result = latest.current.onSave(latest.current.note)
      if (typeof result === 'boolean') finish(result)
      else { setPending(true); void result.then(finish, () => { finish(false) }) }
    } catch { finish(false) }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (props.skipNote) saveRef.current()
  }, [props.skipNote])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root === null || !(event.target instanceof Node)) return
      if (root.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest('[data-dsh-sidenote]') !== null) return
      saveRef.current(true)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const width = popoverWidth(320, props.bounds)
  const left = popoverLeft(props.x, width, props.bounds)
  const top = popoverTop(props.y, 120, props.bounds)

  return (
    <div ref={rootRef} className={css.editorAsk} style={{ left, top, width, maxHeight: (props.bounds?.bottom ?? window.innerHeight) - top - 8, overflowY: 'auto' }}>
      <div className={css.editorAskHeader}>
        <div className={css.editorTarget}>{props.targetTitle ? t('sendToTarget', { title: props.targetTitle }) : ''}</div>
        <button type="button" className={css.dismissButton} aria-label={t('cancel')} title={t('cancel')} onClick={cancel}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      {showNote && (
        <div className={css.editorAskRow}>
          <textarea
            ref={noteInputRef}
            rows={1}
            className={css.editorInput}
            value={note}
            placeholder={t('sideNotePlaceholder')}
            aria-label={t('sideNoteAria')}
            autoFocus
            disabled={pending}
            onChange={(event) => {
              setNote(event.target.value)
              failedRef.current = false
              setFailed(false)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              // IME 保护：组合中（候选窗未提交）的 Enter 属于输入法，不能算确认。
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
              event.preventDefault()
              save()
            }}
          />
          <button
            type="button"
            className={css.confirmButton}
            title={t('confirmTitle')}
            aria-label={t('confirmAskAria')}
            onClick={() => { save() }}
            disabled={pending}
          >
            <IconCheckOutline16 size={14} />
          </button>
        </div>
      )}
      {failed && <div className={css.editorError}>{t('openSideFailed')}</div>}
      {pending && <div className={css.editorTarget} role="status">{t('sideTargetWaiting')}</div>}
    </div>
  )
}

/** The badge layer (one numbered circle per annotation) + the active highlight. */
function BadgeLayer(props: {
  store: AnnotationStore
  sessionId: string
  cache: Map<number, CachedRange>
  editingId: number | null
  onOpen: (annotation: Annotation, point: { x: number; y: number; bounds?: Bounds; targetTitle?: string }) => void
}): ReactNode {
  const mountedSessions = mountedConversationIds()
  const annotations = props.store.sessions().filter(id => mountedSessions.has(id)).flatMap(id => props.store.list(id))
    .filter(annotation => (annotation.sourceSessionId ?? annotation.sessionId) === annotation.sessionId)
  const badges: ReactNode[] = []
  const placed: { x: number; y: number }[] = []
  let highlight: ReactNode = null
  // composer 区域（宿主 [data-composer-seat]，非公开契约，查不到则只按视口
  // 裁剪）：锚点滚进 composer 遮挡区时角标必须隐藏——否则角标会画在 composer
  // 卡片上，看起来像引用块自带的编号（极具迷惑性）。
  // gutter 角标与锚文本拉开了距离——hover 角标时高亮原文，绑定关系始终可见。
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const highlightId = props.editingId ?? hoveredId
  for (const annotation of annotations) {
    const ranges = resolveRanges(annotation, props.cache, props.sessionId)
    if (ranges === null) continue
    const range = ranges[0]!
    const source = quoteSourceOf(range.startContainer, props.sessionId)
    // 跨窗口提问仅保留目标会话的注释预览，不在来源窗口绘制角标和高亮。
    if (source === null || source.sessionId !== annotation.sessionId) continue
    const clip = sourceClip(source)
    if (annotation.id === highlightId) {
      const rects = ranges.flatMap(highlightRectsOf).map(rect => {
        const left = Math.max(rect.left, clip.left), top = Math.max(rect.top, clip.top)
        return { left, top, width: Math.min(rect.left + rect.width, clip.right) - left, height: Math.min(rect.top + rect.height, clip.bottom) - top }
      }).filter(rect => rect.width > 0 && rect.height > 0)
      highlight = rects.map((rect, index) => (
        <div
          key={`hl-${index}`}
          className={css.highlight}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))
    }
    // 角标统一钉消息列右缘 gutter（W03：行内划选旧策略会压住后续文字）。
    const anchor = gutterAnchorOf(range, props.sessionId)
    if (anchor === null) continue
    // 锚点滚出视口的角标不渲染（fixed 定位否则会漂浮在无关内容上方）。
    if (anchor.centerY < clip.top + 9 || anchor.centerY > clip.bottom - 9 || anchor.right - 18 < clip.left || anchor.right > clip.right) continue
    // 同一选区/相邻行的多个角标会落在同一点位——错开保证每个都可点击。
    const point = spreadBadgePoint({ x: anchor.right, y: anchor.centerY }, placed)
    if (point.y > clip.bottom - 9) continue
    placed.push(point)
    badges.push(
      <button
        key={annotation.id}
        type="button"
        className={annotation.state === 'sent' ? `${css.badge} ${css.badgeSent}` : css.badge}
        style={{ left: point.x - 18, top: point.y }}
        title={annotation.state === 'sent'
          ? t('sentBadgeTitle', { n: annotation.number })
          : annotation.note === '' ? annotation.text : `${annotation.text}\n${t('noteLine', { note: annotation.note })}`}
        aria-label={source.surface === 'side' ? `${annotation.number} · ${source.view.dataset.sidenoteViewTitle ?? ''}` : undefined}
        onMouseEnter={() => { setHoveredId(annotation.id) }}
        onMouseLeave={() => { setHoveredId(null) }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onOpen(annotation, { ...point, bounds: clip, targetTitle: source.view.dataset.sidenoteViewTitle })
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
 * 点击外部 = 确认、Esc = 取消，无显式取消按钮). 重开态: 已有注解 + 🗑 删除 +
 * 取消/保存.
 *
 * 导出供单测直接挂载（tests/annotate-editor.spec.tsx）。
 */
export function AnnotationEditor(props: {
  annotation: Annotation
  mode: 'new' | 'edit'
  x: number
  y: number
  bounds?: Bounds
  targetTitle?: string
  onSave: (note: string) => void
  onDelete: () => void
  onCancel: () => void
}): ReactNode {
  useLocaleTick()
  const [note, setNote] = useState(props.annotation.note)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // 外点确认读「当前」注解：下面的 effect 是空依赖闭包，直接捕获 note 会永远停在
  // 首次渲染的值——用户敲完注解再点别处，那段注解会静默丢掉。
  const noteRef = useRef(note)
  noteRef.current = note

  const noteInputRef = useAutoGrowingNote(note)

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
      if (event.target instanceof Element && event.target.closest('[data-dsh-sidenote]') !== null) return
      // 新建态点外部 = 确认这一条：点输入框准备写问题是最常见的下一步动作，以前这里
      // 走 onCancel → 刚创建的注释被整条删除，用户划选的引用凭空消失（Esc 才是显式放弃）。
      // 重开态点外部仍是取消——只关编辑器，已有注解不受影响。
      if (props.mode === 'new') props.onSave(noteRef.current)
      else props.onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const width = popoverWidth(props.mode === 'new' ? 320 : 340, props.bounds)
  const left = popoverLeft(props.x, width, props.bounds)
  const top = popoverTop(props.y, 120, props.bounds)

  const save = (): void => { props.onSave(note) }

  if (props.mode === 'new') {
    return (
      <div ref={rootRef} className={props.targetTitle === undefined ? css.editorNew : css.editorAsk} style={{ left, top, width, maxHeight: (props.bounds?.bottom ?? window.innerHeight) - top - 8, overflowY: 'auto' }}>
        {props.targetTitle !== undefined && <div className={css.editorTarget}>{t('sendToTarget', { title: props.targetTitle })}</div>}
        <div className={css.editorAskRow} style={{ flex: 1 }}>
        <textarea
          ref={noteInputRef}
          className={css.editorInput}
          value={note}
          placeholder={t('notePlaceholder')}
          rows={1}
          autoFocus
          onChange={(event) => { setNote(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            // IME 保护：组合中（候选窗未提交）的 Enter 属于输入法，不能算确认。
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            event.preventDefault()
            save()
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
      </div>
    )
  }

  return (
    <div ref={rootRef} className={css.editorEdit} style={{ left, top, width }}>
      {props.targetTitle !== undefined && <div className={css.editorTarget}>{t('sendToTarget', { title: props.targetTitle })}</div>}
      <textarea
        className={css.editorTextarea}
        value={note}
        placeholder={t('notePlaceholder')}
        rows={3}
        autoFocus
        onChange={(event) => { setNote(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          // IME 保护：组合中（候选窗未提交）的 Enter 属于输入法，不能算保存。
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          event.preventDefault()
          save()
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
