/**
 * 父历史折叠卡（D1，L2 视图）：fork 继承的消息区默认折叠为一张指示卡
 * 「继承自主会话 · 截至 fork 点 · N 条」，点击展开查看（内容与主对话同源
 * 渲染——同一套 MessageRow）。
 *
 * 产品语义（design-draft v3 D1）：模型侧全量继承不变（fork 即快照），UI 分层；
 * 文案标注「截至 fork 点」——fork 后主对话继续推进，本卡是静态快照。
 */
import { useSyncExternalStore } from 'react'
import { DisclosureRow, IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FoldStore } from './viewState.ts'
import { t } from '../locales.ts'
import css from '../sidechat/sidechat.module.css'

export function FoldCard(props: { count: number; rowKey: string; fold: FoldStore; children: React.ReactNode }) {
  const { rowKey, fold } = props
  const open = useSyncExternalStore((fn) => fold.subscribe(fn), () => fold.isOpen(rowKey))
  return (
    <div className={css.toolCardV2}>
      <DisclosureRow
        icon={<IconBranchOutline16 size={14} />}
        title={t('inheritedLabel', { n: props.count })}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { fold.toggle(rowKey) }}
      >
        <div className={css.inheritedBody}>{props.children}</div>
      </DisclosureRow>
    </div>
  )
}
