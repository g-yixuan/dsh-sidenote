/**
 * 工具卡叶子块的 labels 构建器（0.1.2 起各块 labels 为必填/无守卫读取——
 * 缺了在宿主运行时直接崩，e2e 实锤两次：TerminalBlock.copy、ReadBlock.copy）。
 *
 * 类型注记：我们构建期类型是 0.1.1（labels 字段不存在/可选），0.1.2 运行时
 * 要求必填——所以各 builder 返回类型按 0.1.2 形状写、调用点 cast（与
 * markdown.ts 双形状同款姿势）。
 */
import { t } from '../locales.ts'
import { markdownChrome } from './markdown.ts'

/** TerminalBlockLabels（0.1.1 与 0.1.2 同形状）。 */
export function terminalLabels() {
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

/** ReadBlockLabels（0.1.2 必填）。 */
export function readLabels() {
  return {
    window: (shown: number, total: number) => t('readWindow', { shown, total }),
    copy: t('codeCopy'),
    copied: t('codeCopied'),
    collapseAria: t('termCollapseAria'),
    expandAria: (n: number) => t('termExpandAria', { n }),
    collapse: t('termCollapse'),
    expand: (n: number) => t('termExpand', { n }),
  }
}

/** SearchBlockLabels（0.1.2 必填）。 */
export function searchLabels() {
  return {
    pathsSummary: (shown: number, total: number, truncated: boolean) =>
      t('searchPathsSummary', { shown, total }) + (truncated ? '…' : ''),
    matchesSummary: (shown: number, total: number, files: number, truncated: boolean) =>
      t('searchMatchesSummary', { shown, total, files }) + (truncated ? '…' : ''),
    copy: t('codeCopy'),
    copied: t('codeCopied'),
    noResults: t('searchNoResults'),
    collapseAria: t('termCollapseAria'),
    expandAria: (n: number) => t('termExpandAria', { n }),
    collapse: t('termCollapse'),
    expand: (n: number) => t('termExpand', { n }),
  }
}

/** DiffBlockLabels（0.1.2 必填）。 */
export function diffLabels() {
  return {
    copy: t('codeCopy'),
    copied: t('codeCopied'),
    collapseAria: t('termCollapseAria'),
    expandAria: (n: number) => t('termExpandAria', { n }),
    collapse: t('termCollapse'),
    expand: (n: number) => t('termExpand', { n }),
    files: (n: number) => t('diffFiles', { n }),
  }
}

/** WebBlockLabels（0.1.2 必填；markdown 子面复用双形状 chrome）。 */
export function webLabels() {
  return {
    noResults: t('webNoResults'),
    sourcesTruncated: t('webSourcesTruncated'),
    http: 'HTTP',
    contentTruncated: t('webContentTruncated'),
    markdown: markdownChrome(),
  }
}
