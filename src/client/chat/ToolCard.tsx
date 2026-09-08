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
  SearchBlock,
  TerminalBlock,
  WebBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCardModel, ToolCallKind } from './cards.ts'
import type { FoldStore } from './viewState.ts'
import { t } from '../locales.ts'
import { diffLabels, readLabels, searchLabels, terminalLabels, webLabels } from '../host/labels.ts'
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
    <div className={css.flowRow}>
      <DisclosureRow
        icon={icon}
        title={model.title}
        open={open}
        expandable
        expandOnRowClick
        previewChevron
        onToggle={() => { fold.toggle(rowKey) }}
      >
        <ToolCardBody model={model} streaming={props.streaming} />
      </DisclosureRow>
    </div>
  )
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
      return <DiffBlock {...({ labels: diffLabels() } as object)} diffs={model.diffs.map(d => ({ path: d.path, oldText: d.oldText, newText: d.newText }))} />
    case 'read':
      return (
        <ReadBlock
          label={model.path}
          {...({ labels: readLabels() } as object)}
          lines={model.lines.map(l => ({ number: l.number, text: l.text }))}
          totalLines={model.totalLines}
          {...(model.lang !== undefined ? { lang: model.lang } : {})}
        />
      )
    case 'search':
      // SearchBlock 契约：kind ← 我们的 shape（cards.ts 已改名归一），
      // files/paths/truncated/total 形状同构直通。
      return model.shape === 'matches'
        ? <SearchBlock {...({ labels: searchLabels() } as object)} kind="matches" files={[...(model.files ?? [])].map(f => ({ path: f.path, matches: [...f.matches] }))} truncated={model.truncated} total={model.total} />
        : <SearchBlock {...({ labels: searchLabels() } as object)} kind="paths" paths={[...(model.paths ?? [])]} truncated={model.truncated} total={model.total} />
    case 'web':
      return model.webKind === 'search'
        ? <WebBlock {...({ labels: webLabels() } as object)} kind="search" sources={[...(model.sources ?? [])]} truncated={model.truncated === true} {...(model.answer !== undefined ? { answer: model.answer } : {})} />
        : <WebBlock {...({ labels: webLabels() } as object)} kind="fetch" url={model.url ?? ''} statusCode={model.statusCode ?? 0} truncated={model.truncated === true} />
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
