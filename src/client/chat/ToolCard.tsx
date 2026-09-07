/**
 * 工具卡（L2 视图）：DisclosureRow 窄栏壳（默认折叠——密度于默认态）+
 * 展开态用宿主同源叶子块（TerminalBlock/DiffBlock/ReadBlock——材质同源）。
 * 数据全部来自 cards.ts 的 ToolCardModel（本组件零判别逻辑）。
 *
 * P0 落地四卡：generic（自绘）/ terminal / diff / read；search/web 暂经
 * generic 化渲染（cards.ts 保留全量数据，后续 arm 扩展是加法不是返工）。
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import {
  DisclosureRow,
  DiffBlock,
  IconCodeOutline16,
  IconCordisPluginOutline14,
  IconEditOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconPlayOutline16,
  IconRightUpOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  JsonTree,
  ReadBlock,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCardModel, ToolCallKind } from './cards.ts'
import type { FoldStore } from './viewState.ts'
import { t } from '../locales.ts'
import css from '../sidechat/sidechat.module.css'

/** ToolCallKind → 图标（宿主 ui-tool 同族映射；primitives 图标全集见 icons/index.d.ts）。 */
function kindIcon(kind: ToolCallKind): ReactNode {
  switch (kind) {
    case 'read': return <IconListPenOutline16 size={14} />
    case 'edit': return <IconEditOutline16 size={14} />
    case 'delete': return <IconTrashOutline16 size={14} />
    case 'move': return <IconRightUpOutline16 size={14} />
    case 'search': return <IconSearchOutline16 size={14} />
    case 'execute': return <IconPlayOutline16 size={14} />
    case 'fetch': return <IconGlobeOutline14 size={14} />
    default: return <IconCordisPluginOutline14 size={14} />
  }
}

/** 折叠态读取 hook（viewState store 的 React 绑定，L2 侧）。 */
function useFoldOpen(fold: FoldStore, rowKey: string): boolean {
  return useSyncExternalStore(
    (notify) => fold.subscribe(notify),
    () => fold.isOpen(rowKey),
  )
}

export function ToolCard(props: { model: ToolCardModel; rowKey: string; fold: FoldStore; streaming?: boolean }) {
  const { model, rowKey, fold } = props
  const open = useFoldOpen(fold, rowKey)
  const icon = model.kind === 'terminal'
    ? <IconPlayOutline16 size={14} />
    : model.kind === 'diff'
      ? <IconEditOutline16 size={14} />
      : model.kind === 'read'
        ? <IconCodeOutline16 size={14} />
        : model.kind === 'generic' ? kindIcon(model.icon) : <IconCordisPluginOutline14 size={14} />

  return (
    <div className={css.toolCardV2}>
      <DisclosureRow
        icon={icon}
        title={model.title}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { fold.toggle(rowKey) }}
      >
        <ToolCardBody model={model} streaming={props.streaming} />
      </DisclosureRow>
    </div>
  )
}

/**
 * TerminalBlock 的全量 labels（**0.1.2 运行时不传会崩**——其复制按钮无守卫
 * 读 `labels.copy/copied`，W00 排障实证于 0.1.2-rc.1）。按调用点构建保持
 * 本地化新鲜；函数字段按 TerminalBlockLabels 契约。
 */
function terminalLabels() {
  return {
    signal: (signal: string) => t('termSignal', { signal }),
    exitCode: (code: number) => t('termExitCode', { code }),
    running: t('running'),
    failed: t('failed'),
    done: t('termDone'),
    copy: t('codeCopy'),
    copied: t('codeCopied'),
    noOutput: t('termNoOutput'),
    collapseAria: t('termCollapseAria'),
    collapse: t('termCollapse'),
    expandAria: (n: number) => t('termExpandAria', { n }),
    expand: (n: number) => t('termExpand', { n }),
  }
}

function ToolCardBody({ model, streaming }: { model: ToolCardModel; streaming?: boolean }) {
  switch (model.kind) {
    case 'terminal':
      return (
        <TerminalBlock
          command={model.title}
          labels={terminalLabels()}
          {...(model.cwd !== undefined ? { cwd: model.cwd } : {})}
          {...(model.output !== undefined ? { output: model.output } : {})}
          {...(model.exitCode !== undefined ? { exitCode: model.exitCode } : {})}
          {...(model.signal !== undefined ? { signal: model.signal } : {})}
          {...(streaming === true ? { running: true } : {})}
        />
      )
    case 'diff':
      return <DiffBlock diffs={model.diffs.map(d => ({ path: d.path, oldText: d.oldText, newText: d.newText }))} />
    case 'read':
      return (
        <ReadBlock
          label={model.path}
          lines={model.lines.map(l => ({ number: l.number, text: l.text }))}
          totalLines={model.totalLines}
          {...(model.lang !== undefined ? { lang: model.lang } : {})}
        />
      )
    case 'search':
      // interim：搜索卡专属渲染在后续 arm；先给结构化摘要（数据 cards.ts 已保全）。
      return (
        <div className={css.toolGenericBody}>
          <pre className={css.toolBodyText}>
            {model.shape === 'matches'
              ? `${model.files?.length ?? 0} 个文件 / ${model.total} 处匹配${model.truncated ? '（已截断）' : ''}`
              : `${model.paths?.length ?? 0} / ${model.total} 个路径${model.truncated ? '（已截断）' : ''}`}
          </pre>
        </div>
      )
    case 'web':
      return (
        <div className={css.toolGenericBody}>
          {model.webKind === 'search' && model.sources !== undefined && (
            <pre className={css.toolBodyText}>{model.sources.map(s => `${s.title ?? ''}\n${s.url}`).join('\n\n')}</pre>
          )}
          {model.webKind === 'fetch' && (
            <pre className={css.toolBodyText}>{`${model.url ?? ''} → ${model.statusCode ?? '?'}${model.truncated ? '（已截断）' : ''}`}</pre>
          )}
        </div>
      )
    default: {
      // generic（宿主默认卡形态的自绘：标题行在壳上，体 = rawInput/正文/文件列表）。
      const m = model
      return (
        <div className={css.toolGenericBody}>
          {m.bodyText !== undefined && m.bodyText !== '' && <pre className={css.toolBodyText}>{m.bodyText}</pre>}
          {m.rawInput !== undefined && (
            typeof m.rawInput === 'string'
              ? <pre className={css.toolBodyText}>{m.rawInput}</pre>
              : <JsonTree data={m.rawInput as object} />
          )}
          {m.locations !== undefined && m.locations.length > 0 && (
            <div className={css.toolLocations}>
              {m.locations.map(l => `${l.path}${l.line !== undefined ? `:${l.line}` : ''}`).join('\n')}
            </div>
          )}
          {m.bodyText === undefined && m.rawInput === undefined && streaming === true && (
            <div className={css.toolBodyText}>{t('running')}</div>
          )}
        </div>
      )
    }
  }
}
