/**
 * T2 off-face 探测清单（版本韧性架构，architecture.md 第四节）。
 *
 * 纪律：off-face 调用点保持就地 feature-check + 降级（姿势不变）；本清单是
 * 「全景一次」——插件激活时逐项探测并 warn-once，让「宿主升级后哪些降级了」
 * 在开发者工具里一眼可见，而不是等功能被用时才静默残疾。
 * 告警通道显式裁决：console-only（开发者日志），不做用户可见 UI。
 *
 * 新增 off-face 依赖时：调用点照写就地探测，同时把条目加进 PROBES。
 */
import type { Context } from './contracts.ts'
import { nativeSidebarHost } from '../sidechat/native.ts'
import { remoteSessionFace } from '../sidechat/lifecycle.ts'

interface Probe {
  /** 探测项名称（告警文案用）。 */
  readonly name: string
  /** 探测函数：true = 能力在；false/异常 = 缺失（将降级）。 */
  readonly check: (ctx: Context) => boolean
  /** 缺失时的降级说明（告警文案用）。 */
  readonly fallback: string
}

const PROBES: readonly Probe[] = [
  {
    name: 'Session.open()（非 staged 会话开窗）',
    check: (ctx) => {
      // open 在 concrete Session 实例上（不在 SessionFace 契约）——探测类原型不可行，
      // 这里探测契约面的替代信号：sessions.binding 存在即可（open 调用点另有就地探测）。
      return typeof ctx.sessions?.binding === 'function'
    },
    fallback: '侧边聊天消息流降级为只发不收',
  },
  {
    name: 'conversation.input 输入机器',
    check: (ctx) => {
      const conv = (ctx as { get?: (k: string) => unknown }).get?.('conversation') as
        | { input?: { for?: unknown } }
        | undefined
      return typeof conv?.input?.for === 'function'
    },
    fallback: '侧边 composer 降级为本地草稿 + session.prompt',
  },
  {
    name: 'commandUi（斜杠命令注册）',
    check: (ctx) => {
      const ui = (ctx as { get?: (k: string) => unknown }).get?.('commandUi') as
        | { register?: unknown }
        | undefined
      return typeof ui?.register === 'function'
    },
    fallback: '/side 与「/侧边」命令不可用（菜单/顶栏入口仍在）',
  },
  {
    name: 'ctx.modules.import（动态组件复用）',
    check: (ctx) => {
      const modules = (ctx as { modules?: { import?: unknown } }).modules
      return typeof modules?.import === 'function'
    },
    fallback: 'ProducedFiles 等动态复用件降级为自绘',
  },
  {
    name: 'sidebarRight.focus（native tab 程序化聚焦）',
    check: (ctx) => {
      // 仅 better-sidebar >= 0.19（native 右栏）需要的面；老宿主的
      // activateTab 本就可用，缺失不算降级。
      if (!nativeSidebarHost(ctx)) return true
      const face = (ctx as { get?: (k: string) => unknown }).get?.('sidebarRight') as
        | { focus?: unknown }
        | undefined
      return typeof face?.focus === 'function'
    },
    fallback: '聚焦既有侧边聊天 tab 不可用（activateTab 在 native 面是空操作）',
  },
  {
    name: '会话模型面（remote.session / connection.api.sessions 双版本链）',
    check: (ctx) => {
      // 新面（0.1.5 的 remote.session）与旧面（<= 0.1.2 的 connection.api）
      // 任一在列即能力在——双版本链的探测与调用点同序（lifecycle.ts）。
      if (remoteSessionFace(ctx) !== undefined) return true
      const legacy = (ctx as { connection?: { api?: { sessions?: { models?: unknown } } } })
        .connection?.api?.sessions?.models
      return typeof legacy === 'function'
    },
    fallback: 'fork 模型同步、模型标签与模型切换不可用（子会话用宿主默认模型）',
  },
]

/** 激活时跑一遍探测清单；缺失项逐项 warn-once。返回缺失项数（测试可断言）。 */
export function probeHost(ctx: Context): number {
  let missing = 0
  for (const probe of PROBES) {
    let ok = false
    try {
      ok = probe.check(ctx)
    } catch {
      ok = false
    }
    if (!ok) {
      missing += 1
      console.warn(`[dsh-sidenote] 宿主能力缺失：${probe.name} → ${probe.fallback}`)
    }
  }
  return missing
}
