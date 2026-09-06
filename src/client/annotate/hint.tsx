/**
 * 首次使用引导（Delivery_02 Workitem_02 发现性）：划选注释对新用户零暗示
 * （B1 盲测 8 分钟才发现）——在「页面已出现 assistant 回复且用户从未见过
 * 引导」时，于对话区右下浮出一张一次性提示卡：关闭或 12s 后自动消失，
 * localStorage 记账，终身只此一次。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { t, useLocaleTick } from '../locales.ts'
import css from './annotate.module.css'

const HINT_KEY = 'dsh-sidenote:hint:v1'

function hintSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(HINT_KEY) === '1'
  } catch {
    return true // 无 storage 环境不出引导（宁可不打扰）
  }
}

function markHintSeen(): void {
  try {
    globalThis.localStorage?.setItem(HINT_KEY, '1')
  } catch {
    // 忽略
  }
}

export function FirstUseHint(): ReactNode {
  useLocaleTick()
  const [visible, setVisible] = useState(false)

  // 出现条件轮询：assistant 消息已在屏（selection 模块的排除根之外存在
  // [data-chat-flow-kind] 节点）且从未展示过。10s 轮询足够轻。
  const tick = useSyncExternalStore(
    (cb) => {
      const timer = window.setInterval(cb, 2000)
      return () => { window.clearInterval(timer) }
    },
    () => document.querySelector('[data-chat-flow-kind]') !== null,
  )

  useEffect(() => {
    if (!tick || hintSeen()) return
    setVisible(true)
    markHintSeen()
    const timer = window.setTimeout(() => { setVisible(false) }, 12_000)
    return () => { window.clearTimeout(timer) }
  }, [tick])

  if (!visible) return null
  return (
    <div className={css.hint} role="note">
      <span>{t('hintText')}</span>
      <button
        type="button"
        className={css.hintClose}
        aria-label={t('hintClose')}
        onClick={() => { setVisible(false) }}
      >
        ×
      </button>
    </div>
  )
}
