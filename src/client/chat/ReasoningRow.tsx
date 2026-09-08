/**
 * 思考折叠行（L2 视图）：DisclosureRow 壳取代原生 <details>——与工具卡同
 * 一套镀铬（材质同源）。行为对齐宿主 ReasoningRow 语义：流式中默认展开
 * （用户在看推理），完成后默认折叠；用户显式收起过就不再自动展开
 * （fold.has 区分「未触碰」与「显式收起」）。
 */
import { useSyncExternalStore } from 'react'
import { DisclosureRow, IconThinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FoldStore } from './viewState.ts'
import { t } from '../locales.ts'
import css from '../sidechat/sidechat.module.css'

export function ReasoningRow(props: { text: string; rowKey: string; fold: FoldStore; streaming?: boolean }) {
  const { rowKey, fold } = props
  const touched = useSyncExternalStore((fn) => fold.subscribe(fn), () => fold.has(rowKey))
  const stored = useSyncExternalStore((fn) => fold.subscribe(fn), () => fold.isOpen(rowKey))
  // 流式中且用户未触碰 → 默认展开；其余听 store。
  const open = stored || (props.streaming === true && !touched)
  return (
    <div className={css.flowRow}>
      <DisclosureRow
        icon={<IconThinkOutline16 size={14} />}
        title={t('thinking')}
        open={open}
        expandable
        expandOnRowClick
        previewChevron
        onToggle={() => { fold.toggle(rowKey) }}
      >
        <div className={css.reasoningBody}>{props.text}</div>
      </DisclosureRow>
    </div>
  )
}
