/**
 * 「@ 引用侧边聊天」触发源（WI-04，D4/@引用回流入口）：主输入框（任意会话）
 * 敲 @ → 候选列出当前会话的开启中侧边聊天 → 选中即在草稿插入引用 chip；
 * 提交时 codec.serialize 把侧聊内容序列化为结构化 XML 上下文块注入。
 *
 * 机制事实（技术审查修正了早先「codec 无注册面」的记录）：InputTriggerSource
 * 可自带 `codec`（trigger/types.d.ts）——serialize 在提交时按调用、异步、
 * 失败阻断发送（不静默降级）。
 *
 * 序列化形态（与回流协议同族）：<side-chat source="侧边 N"> 内按序 <问>/<答>
 * 对。不截断（用户裁定），但只含问答对——工具卡/思考不进。
 */
import type { Context } from '../host/contracts.ts'
import { collectSideTabs, parseSideChatMeta } from './model.ts'
import { betterSidebarOf, directNativeLeg } from './native.ts'
import { sideChatMetasAll, sideChatMetasOf } from './metaStore.ts'
import { sideChatTitleOf } from './identity.ts'
import { xmlAttr } from '../protocol.ts'
import { transcriptOf, type ChatMessage } from '../chat/transcript.ts'
import { chatSourceOf } from './lifecycle.ts'
import { pairQuestions } from './model.ts'

/** input-trigger 服务的最小镜像（registerSource + 关局部）。 */
interface InputTriggersService {
  registerSource(src: unknown): () => void
}

const TRIGGER = '@'
const SOURCE = 'sidenote-side-chats'

/**
 * 候选名 → childId 的映射缓存，按会话分键（Delivery_05 碰撞护栏）：onPick
 * 只能拿到候选 name 字符串（宿主 API 形状），topic 化标题后撞名成为可能
 * （legacy 多实例两个同主题）。candidates() 每次计算时重建本会话的映射
 * 并对重名追加序号消歧；onPick 只按 (sessionId, name) 查——跨会话复用
 * 陈旧候选拿不到 ref（审查 M2：全局单映射会把 A 会话的 childId 插进 B）。
 */
const lastCandidateRefs = new Map<string, Map<string, string>>()

/** 候选名消歧（导出纯可测）：重名依次追加「 · 2」「 · 3」，本批内唯一。 */
export function dedupeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name)
    return name
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${name} · ${n}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
}

/** 侧聊内容 → 结构化引用块（问答成对，全文不截断）。 */
export async function serializeSideChatRef(ctx: Context, childId: string): Promise<string> {
  const binding = ctx.sessions.binding(childId)
  const source = chatSourceOf(ctx, binding)
  const snap = source?.getLegacy()
  const messages: readonly ChatMessage[] = transcriptOf(snap)
  const pairs = pairQuestions(messages)
  const parts: string[] = []
  for (const m of messages) {
    if (m.role !== 'assistant' || m.text === '' || m.streaming === true) continue
    const q = pairs.get(m.key)
    if (q !== undefined) parts.push(`<问>${q}</问>`)
    parts.push(`<答>${m.text}</答>`)
  }
  const title = (() => {
    // 找回 Tab 标题（childId → tab）：直连腿查 metaStore，legacy 查布局快照。
    try {
      if (directNativeLeg(ctx)) {
        const meta = sideChatMetasAll().find(m => m.childId === childId)
        if (meta !== undefined) return sideChatTitleOf(meta)
      }
      for (const tab of collectSideTabs(betterSidebarOf(ctx)?.getSnapshot().state)) {
        if (parseSideChatMeta(tab.meta).childId === childId) return tab.title
      }
    } catch { /* fall through */ }
    return childId
  })()
  return `<side-chat-reference source="${xmlAttr(title)}" note="用户 @ 引用的侧边聊天内容（问答成对）">\n${parts.join('\n')}\n</side-chat-reference>`
}

/** 注册「@ 侧聊」触发源；服务缺席静默降级（不影响其他入口）。 */
export function registerSideChatReferenceSource(ctx: Context): void {
  let svc: InputTriggersService | undefined
  try {
    svc = ctx.get('inputTriggers') as InputTriggersService | undefined
  } catch {
    return
  }
  if (svc === undefined || typeof svc.registerSource !== 'function') return

  try {
    ctx.effect(() => svc.registerSource({
      trigger: TRIGGER,
      name: SOURCE,
      order: 50,
      // 候选 = 当前会话已开启的侧边聊天（topic 化标题，重名消歧）。
      candidates: (session: { sessionId?: string } | undefined) => {
        // 早退统一先把本会话映射清空——陈旧名字不得再被 pick（审查 M2）。
        if (session?.sessionId === undefined) return Promise.resolve([])
        const sessionId = session.sessionId
        try {
          // 直连腿：存活记录即候选（metaStore 枚举，childId 已登记的）；
          // legacy 腿：布局快照（标题已被 setSideChatTopic patch 成 topic 化）。
          const base: Array<{ name: string, childId: string }> = []
          if (directNativeLeg(ctx)) {
            for (const meta of sideChatMetasOf(sessionId)) {
              if (meta.childId !== undefined) base.push({ name: sideChatTitleOf(meta), childId: meta.childId })
            }
          } else {
            const snapshot = betterSidebarOf(ctx)?.getSnapshot()
            if (snapshot === undefined || snapshot.sessionId !== sessionId || snapshot.state === undefined) {
              lastCandidateRefs.set(sessionId, new Map())
              return Promise.resolve([])
            }
            for (const tab of collectSideTabs(snapshot.state)) {
              const childId = parseSideChatMeta(tab.meta).childId
              if (childId !== undefined) base.push({ name: tab.title, childId })
            }
          }
          const taken = new Set<string>()
          const refs = new Map<string, string>()
          const out = base.map((entry) => {
            const name = dedupeName(entry.name, taken)
            refs.set(name, entry.childId)
            return { name, description: '侧边聊天', icon: '💬' }
          })
          lastCandidateRefs.set(sessionId, refs)
          return Promise.resolve(out)
        } catch {
          lastCandidateRefs.set(sessionId, new Map())
          return Promise.resolve([])
        }
      },
      // pick → 插入引用 chip（ref = childId；label/clipboardText 供渲染与复制）。
      onPick: (pick: { candidate: { name: string } }, session: { sessionId?: string } | undefined) => {
        if (session?.sessionId === undefined) return undefined
        // 名称 ↔ childId 的映射按会话查最近一次 candidates() 缓存（碰撞护栏）。
        const childId = lastCandidateRefs.get(session.sessionId)?.get(pick.candidate.name)
        if (childId === undefined) return undefined
        return {
          insert: {
            source: SOURCE,
            ref: childId,
            label: pick.candidate.name,
            clipboardText: `@${pick.candidate.name}`,
          },
        }
      },
      codec: {
        clipboardText: (ref: string) => `@${ref}`,
        serialize: (ref: string, _signal: AbortSignal) => serializeSideChatRef(ctx, ref),
      },
    }), 'dsh-sidenote: @ side-chat reference source')
  } catch (error) {
    console.warn('[dsh-sidenote] @ 引用源注册失败:', error)
  }
}
