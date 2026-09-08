/**
 * R8 审批/提问答复卡（L2 视图）：钉在 composer 上方（原 pendingBar 位置）。
 * 自绘 + primitives 图标（材质同源，不求像素级复刻宿主审批卡）。
 *
 * 竞答纪律：先答先得——点击后置 answered 本地态；answer 失败（已被主视图
 * 抢答/settle）catch 吞错并回退按钮态（宿主 `.catch(() => setAnswered(false))`
 * 同款）；卡片消失由快照驱动（pending 项消失即卸载），UI 不自造状态机。
 */
import { useState } from 'react'
import { IconWarningOutline16, IconQuestionOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingItem, PendingQuestionView } from './pending.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

export function PendingCardList({ items }: { items: readonly PendingItem[] }) {
  return (
    <>
      {items.map(item => item.kind === 'approval'
        ? <ApprovalCard key={item.key} item={item} />
        : <QuestionCard key={item.key} item={item} />)}
    </>
  )
}

/** 审批卡：reason + 拒绝 / 允许一次。 */
function ApprovalCard({ item }: { item: Extract<PendingItem, { kind: 'approval' }> }) {
  useLocaleTick()
  const [answered, setAnswered] = useState(false)
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    setAnswered(true)
    item.answer(outcome).catch(() => { setAnswered(false) })
  }
  return (
    <div className={css.pendingCard} data-kind="approval">
      <div className={css.pendingHead}>
        <IconWarningOutline16 size={14} />
        <span className={css.pendingTitle}>{t('pendingApprovalTitle')}</span>
      </div>
      <div className={css.pendingDesc}>{t('pendingApprovalDesc', { name: item.toolName })}</div>
      {item.reason !== undefined && item.reason !== '' && <div className={css.pendingReason}>{item.reason}</div>}
      <div className={css.pendingActions}>
        <button type="button" className={css.pendingBtnGhost} disabled={answered} onClick={() => { answer('rejected') }}>
          {t('pendingReject')}
        </button>
        <button type="button" className={css.pendingBtnPrimary} disabled={answered} onClick={() => { answer('allowed-once') }}>
          {t('pendingAllowOnce')}
        </button>
      </div>
    </div>
  )
}

/** 提问卡：选项（单选即点即答语义并入整批提交）+ 自定义 + 整批提交/取消。 */
function QuestionCard({ item }: { item: PendingQuestionView }) {
  useLocaleTick()
  // 每题的选择集合（多选为 Set；单选为单元素 Set）+ 自定义文本。
  const [selections, setSelections] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
  const [customs, setCustoms] = useState<ReadonlyMap<string, string>>(new Map())
  const [answered, setAnswered] = useState(false)

  const toggle = (qid: string, label: string, multi: boolean): void => {
    const next = new Map(selections)
    const cur = new Set(next.get(qid) ?? [])
    if (multi) {
      if (cur.has(label)) cur.delete(label)
      else cur.add(label)
    } else {
      cur.clear()
      cur.add(label)
    }
    next.set(qid, cur)
    setSelections(next)
  }

  // 提交门槛：每题至少有选中项或自定义文本（整批语义，不留空题）。
  const ready = item.questions.every(q =>
    (selections.get(q.id)?.size ?? 0) > 0 || (customs.get(q.id)?.trim() ?? '') !== '',
  )

  const submit = (): void => {
    setAnswered(true)
    item.answer(item.questions.map(q => ({
      id: q.id,
      selected: [...(selections.get(q.id) ?? [])],
      ...((customs.get(q.id)?.trim() ?? '') !== '' ? { custom: customs.get(q.id)!.trim() } : {}),
    }))).catch(() => { setAnswered(false) })
  }
  const cancel = (): void => {
    setAnswered(true)
    item.cancel().catch(() => { setAnswered(false) })
  }

  return (
    <div className={css.pendingCard} data-kind="question">
      <div className={css.pendingHead}>
        <IconQuestionOutline14 size={14} />
        <span className={css.pendingTitle}>
          {item.planReview ? t('pendingPlanReview') : t('pendingQuestionTitle')}
        </span>
      </div>
      {item.questions.map(q => (
        <div key={q.id} className={css.pendingQuestion}>
          {q.header !== undefined && q.header !== '' && <div className={css.pendingQHeader}>{q.header}</div>}
          <div className={css.pendingQText}>{q.question}</div>
          {q.detail !== undefined && q.detail !== '' && <div className={css.pendingReason}>{q.detail}</div>}
          {q.options.map(o => {
            const active = selections.get(q.id)?.has(o.label) === true
            return (
              <button
                key={o.label}
                type="button"
                className={active ? css.pendingOptionActive : css.pendingOption}
                disabled={answered}
                onClick={() => { toggle(q.id, o.label, q.multiSelect) }}
              >
                {o.label}
                {o.description !== undefined && o.description !== '' && <span className={css.pendingOptionDesc}>{o.description}</span>}
              </button>
            )
          })}
          <input
            className={css.pendingCustom}
            placeholder={t('pendingCustomPlaceholder')}
            disabled={answered}
            value={customs.get(q.id) ?? ''}
            onChange={(event) => {
              const next = new Map(customs)
              next.set(q.id, event.target.value)
              setCustoms(next)
            }}
          />
        </div>
      ))}
      <div className={css.pendingActions}>
        <button type="button" className={css.pendingBtnGhost} disabled={answered} onClick={cancel}>
          {t('pendingQuestionCancel')}
        </button>
        <button type="button" className={css.pendingBtnPrimary} disabled={answered || !ready} onClick={submit}>
          {t('pendingQuestionSubmit')}
        </button>
      </div>
    </div>
  )
}
