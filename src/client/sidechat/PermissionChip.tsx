/**
 * 权限 chip（WI-02，D2 定档 c：同权 + 常显）：显示子会话当前权限档位，
 * 点击弹 Menu 切换（原生同路径：`session.command('/permission <id>')`）。
 *
 * 数据：session.projections.faceOf('permissions')（off-face——缺席则 chip
 * 不渲染）。KnobState = {preset, sandbox, approval}，preset null = 组合默认
 * （默认表 workspace-write/danger-full-access，dsh-permission-presets 实证）。
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import { IconChevronDownOutline14, IconInspectOutline12, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionFace } from '../host/contracts.ts'
import { t } from '../locales.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

/** KnobState 镜像（dsh-permission-presets：preset/sandbox/approval 三旋钮）。 */
interface KnobState {
  preset?: string | null
  sandbox?: string | null
  approval?: string | null
}

/** preset 机器值 → 展示名（宿主 displayPermissionPreset 同款：Full access 特例）。 */
function presetLabel(preset: string): string {
  if (preset === 'danger-full-access') return t('permFullAccess')
  return preset
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** 默认表（dsh-permission-presets bundle 实证，0.1.1/0.1.2 同）。 */
const KNOWN_PRESETS = ['workspace-write', 'danger-full-access'] as const

export function PermissionChip(props: { session: SessionFace | undefined }) {
  useLocaleTick()
  const [open, setOpen] = useState(false)

  // off-face 探测：projections 面缺席（老宿主）→ chip 不渲染。
  const face = useMemo(() => {
    const p = props.session as unknown as { projections?: { faceOf?: (key: string) => { subscribe(f: () => void): () => void; getSnapshot(): unknown } } } | undefined
    return typeof p?.projections?.faceOf === 'function' ? p.projections.faceOf('permissions') : undefined
  }, [props.session])

  const knob = useSyncExternalStore(
    (fn) => face?.subscribe(fn) ?? (() => {}),
    () => (face?.getSnapshot() as KnobState | undefined) ?? null,
  )

  if (face === undefined || knob === null) return null
  // preset 缺省 = 组合默认（默认部署 = workspace-write + ask）。
  const effective = knob.preset ?? 'workspace-write'

  const items: MenuEntry[] = KNOWN_PRESETS.map(id => ({
    id,
    label: presetLabel(id) + (id === effective ? ' ✓' : ''),
  }))

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
          title={t('permChipTitle')}
          onClick={() => { setOpen(!open) }}
        >
          <IconInspectOutline12 size={12} />
          <span>{presetLabel(effective)}</span>
          <IconChevronDownOutline14 size={12} />
        </button>
      }
      items={items}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        setOpen(false)
        void props.session?.command(`/permission ${id}`).catch(() => {})
      }}
    />
  )
}
