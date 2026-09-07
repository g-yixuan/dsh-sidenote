/**
 * 模型选择器（WI-02）：composer 脚部的模型 chip → 两级 Menu（provider 分组
 * 标签 + 型号行）。数据走 wire 面（sessions.models/selectModel——fork 时
 * 同步主会话的同款通道）；切的是子会话自己的选择，不回写主会话。
 *
 * 懒加载：首次打开才拉目录（models RPC 有成本）；切换后本地标签立即更新
 * （selectModel 返回的 selected 为准）。
 */
import { useState } from 'react'
import { IconCheckOutline16, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SessionModelsResult } from '../host/contracts.ts'
import { listModels, switchModel } from './lifecycle.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

export function ModelMenu(props: {
  ctx: Context
  sessionId: string
  /** 当前展示名（fork 同步后主会话模型 / 或用户已切换的）。 */
  modelName: string | null
  onSwitched: (name: string) => void
}) {
  useLocaleTick()
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<SessionModelsResult | null>(null)
  const [switching, setSwitching] = useState(false)

  const openMenu = (): void => {
    setOpen(true)
    if (models !== null) return
    void listModels(props.ctx, props.sessionId).then((m) => {
      if (m !== null) setModels(m)
    })
  }

  const items: MenuEntry[] = []
  if (models !== null) {
    for (const group of models.groups) {
      items.push({ type: 'label', id: `g:${group.id}`, text: group.name })
      for (const m of group.models) {
        const selected = models.current.provider === group.id && models.current.model === m.id
        items.push({
          id: `${group.id}/${m.id}`,
          label: m.name,
          ...(selected ? { icon: <IconCheckOutline16 size={12} /> } : {}),
        })
      }
    }
  }

  return (
    <Menu
      open={open}
      side="top"
      portal
      compact
      anchor={
        <button
          type="button"
          className={css.modelSelect}
          title={t('modelSwitchTitle')}
          onClick={() => { open ? setOpen(false) : openMenu() }}
        >
          {t('modelLabel', { name: props.modelName ?? t('modelFollowsMain') })}
        </button>
      }
      items={items}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        const slash = id.indexOf('/')
        if (slash === -1 || models === null) return
        const provider = id.slice(0, slash)
        const model = id.slice(slash + 1)
        setOpen(false)
        setSwitching(true)
        void switchModel(props.ctx, props.sessionId, provider, model)
          .then((name) => { if (name !== null) props.onSwitched(name) })
          .finally(() => { setSwitching(false) })
      }}
    />
  )
}
