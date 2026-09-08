/**
 * 侧边聊天 composer（L2）：自绘输入壳 + 斜杠/@ 菜单接线 + 模型/权限 chip +
 * 附件 rail。自 SideChatPanel.tsx 拆出（WI-02 主战场，面板壳只留编排）。
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { IconPaperclipOutline16, IconSendOutline16, IconStopFill16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SessionFace } from '../host/contracts.ts'
import type { Composer } from './composer.ts'
import { ModelMenu } from './ModelMenu.tsx'
import { PermissionChip } from './PermissionChip.tsx'
import { arbitrateKeyOf, guardOf, resolveTriggerController, useSlashMenuState, SlashMenuView } from './composer/slash.tsx'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

/** 底部 composer：自绘输入框；模型标签显示子会话真实当前模型（fork 时同步主会话选择）。 */
export function ComposerBar(props: {
  ctx: Context
  session: SessionFace | undefined
  composer: Composer
  running: boolean
  visible: boolean
  modelName: string | null
  childId: string | undefined
  onModelSwitched: (name: string) => void
}) {
  useLocaleTick()
  const { session, composer, running, visible } = props
  const childIdForMenu = props.childId
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 斜杠/@ 触发菜单（WI-02）：官方 inputTriggers 控制器（公开契约面）+
  // 自绘皮。控制器缺席（老宿主/解析失败）时全部行为静默回退现状。
  const triggerCtl = useMemo(
    () => resolveTriggerController(props.ctx, props.childId),
    [props.ctx, props.childId],
  )
  const menuState = useSlashMenuState(triggerCtl)
  const menuOpen = menuState?.open === true

  // 面板可见时预聚焦输入框（sidebar-qa AskPanel 同款）。
  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  return (
    <div className={css.composer}>
      {menuOpen && menuState !== null && triggerCtl !== null && (
        <SlashMenuView state={menuState} onPick={(source, index) => { triggerCtl.pick(source, index) }} />
      )}
      <div className={css.composerCard}>
        {composer.imagePreviews.length > 0 && (
          <div className={css.attachRail}>
            {composer.imagePreviews.map(img => (
              <span key={img.id} className={css.attachThumb}>
                <img src={img.url} alt="" className={css.attachImg} />
                <button
                  type="button"
                  className={css.attachRemove}
                  aria-label={t('attachRemove')}
                  onClick={() => { composer.removeImage(img.id) }}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className={css.input}
          placeholder={t('inputPlaceholder')}
          value={composer.draft}
          onChange={(event) => {
            composer.setDraft(event.target.value)
            // 触发侦听（CAS 语义：带最新 draftRev，过期静默 no-op 由机器兜）。
            triggerCtl?.track(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
              guardOf(composer.phase),
              composer.draftRev ?? 0,
            )
          }}
          onKeyDown={(event) => {
            // 菜单开着先仲裁（上下/Enter 选中/Esc 关闭归控制器）。
            if (menuOpen && triggerCtl !== null) {
              const arbKey = arbitrateKeyOf(event.key)
              if (arbKey !== null) {
                const outcome = triggerCtl.arbitrate(arbKey, event.nativeEvent.isComposing)
                if (outcome !== 'pass') {
                  event.preventDefault()
                  return
                }
              }
            }
            // IME 保护：组合中（候选窗未提交）的 Enter 属于输入法。
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            event.preventDefault()
            // busy-Enter：Cmd/Ctrl+Enter = steer（插队打断）；裸 Enter 由机器/
            // 设置裁决（默认 queue——与主对话同语义）。
            composer.submit(event.metaKey || event.ctrlKey ? 'steer' : undefined)
          }}
        />
        <div className={css.composerFoot}>
          {composer.canAttach && (
            <button
              type="button"
              className={css.attachButton}
              title={t('attachTitle')}
              aria-label={t('attachTitle')}
              onClick={() => { fileInputRef.current?.click() }}
            >
              <IconPaperclipOutline16 size={14} />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              if (files.length > 0) composer.attachImages(files)
              event.target.value = ''
            }}
          />
          {childIdForMenu !== undefined
            ? (
              <span className={css.composerChips}>
                <PermissionChip session={session} />
                <ModelMenu ctx={props.ctx} sessionId={childIdForMenu} modelName={props.modelName} onSwitched={props.onModelSwitched} />
              </span>
            )
            : <span className={css.modelLabel}>{t('modelLabel', { name: props.modelName ?? t('modelFollowsMain') })}</span>}
          {running
            ? (
              <button
                type="button"
                className={css.stopButton}
                title={t('stopReplyTitle')}
                aria-label={t('stopReplyTitle')}
                onClick={() => { session?.cancel().catch(() => {}) }}
              >
                <IconStopFill16 size={12} />
              </button>
            )
            : (
              <button
                type="button"
                className={css.sendButton}
                title={t('send')}
                aria-label={t('send')}
                disabled={composer.draft.trim() === ''}
                onClick={() => { composer.submit() }}
              >
                <IconSendOutline16 size={14} />
              </button>
            )}
        </div>
      </div>
      {composer.sendError !== null && <div className={css.errorRow}>{composer.sendError}</div>}
    </div>
  )
}
