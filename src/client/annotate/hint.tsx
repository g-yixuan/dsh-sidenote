/**
 * 首次使用引导（Delivery_02 Workitem_02 发现性）：划选注释对新用户零暗示
 * （B1 盲测 8 分钟才发现）——在「页面已出现会话消息且用户从未见过引导」
 * 时，于对话区右下浮出一张一次性提示卡：关闭或 12s 后自动消失，
 * localStorage 记账，终身只此一次。
 */
import { useEffect, useState } from 'react'
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

/** 消息流已在屏（任意会话流节点）。 */
function hasMessages(): boolean {
  return document.querySelector('[data-chat-flow-kind]') !== null
}

export function FirstUseHint(): ReactNode {
  useLocaleTick()
  const [visible, setVisible] = useState(false)

  // 展示前：2s 轮询等消息出现；展示（或已展示过）后轮询即停。
  useEffect(() => {
    if (visible || hintSeen()) return
    const poll = window.setInterval(() => {
      if (!hasMessages()) return
      markHintSeen()
      setVisible(true)
    }, 2000)
    return () => { window.clearInterval(poll) }
  }, [visible])

  // 展示后：12s 自动消失（与轮询生命周期解耦）。
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => { setVisible(false) }, 12_000)
    return () => { window.clearTimeout(timer) }
  }, [visible])

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
