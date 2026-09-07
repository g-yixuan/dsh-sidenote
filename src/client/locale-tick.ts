/**
 * React 绑定点（从 locales.ts 拆出）：字典/t() 是纯逻辑层（L0 可测），
 * 本 hook 是唯一的 react 依赖——拆开让 L0 不再经 locales 传递性引入 react
 * （WI-00 分层纪律，arch-audit §1.3）。
 */
import { useSyncExternalStore } from 'react'
import { localeSnapshot, subscribeLocale } from './locales.ts'

/** 语言切换时驱动组件重渲（useSyncExternalStore 标准接法）。 */
export function useLocaleTick(): void {
  useSyncExternalStore(subscribeLocale, localeSnapshot)
}
