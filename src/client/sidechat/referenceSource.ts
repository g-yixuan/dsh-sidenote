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
import { directNativeLeg } from './native.ts'
import { sideChatMetasAll, sideChatMetasOf } from './metaStore.ts'
import { t } from '../locales.ts'
import { transcriptOf, type ChatMessage } from '../chat/transcript.ts'
import { chatSourceOf } from './lifecycle.ts'
import { pairQuestions } from './model.ts'

/** input-trigger 服务的最小镜像（registerSource + 关局部）。 */
interface InputTriggersService {
  registerSource(src: unknown): () => void
}

const TRIGGER = '@'
const SOURCE = 'sidenote-side-chats'

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
        if (meta !== undefined) return meta.number <= 1 ? t('tabBaseTitle') : `${t('tabBaseTitle')} ${meta.number}`
      }
      for (const tab of collectSideTabs(ctx.betterSidebar?.getSnapshot().state)) {
        if (parseSideChatMeta(tab.meta).childId === childId) return tab.title
      }
    } catch { /* fall through */ }
    return childId
  })()
  return `<side-chat-reference source="${title}" note="用户 @ 引用的侧边聊天内容（问答成对）">\n${parts.join('\n')}\n</side-chat-reference>`
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
      // 候选 = 当前会话已开启的侧边聊天（按 Tab 标题）。
      candidates: (session: { sessionId?: string } | undefined) => {
        try {
          // 防御：0.1.2 的会话投影形状漂移（实证：session 可能 undefined）。
          if (session?.sessionId === undefined) return Promise.resolve([])
          // 直连腿：存活记录即候选（metaStore 枚举，childId 已登记的）。
          if (directNativeLeg(ctx)) {
            return Promise.resolve(
              sideChatMetasOf(session.sessionId)
                .filter(meta => meta.childId !== undefined)
                .map(meta => ({
                  name: meta.number <= 1 ? t('tabBaseTitle') : `${t('tabBaseTitle')} ${meta.number}`,
                  description: '侧边聊天',
                  icon: '💬',
                })),
            )
          }
          const snapshot = ctx.betterSidebar?.getSnapshot()
          if (snapshot === undefined || snapshot.sessionId !== session.sessionId || snapshot.state === undefined) return Promise.resolve([])
          return Promise.resolve(
            collectSideTabs(snapshot.state).map(tab => ({
              name: tab.title,
              description: '侧边聊天',
              icon: '💬',
            })),
          )
        } catch {
          return Promise.resolve([])
        }
      },
      // pick → 插入引用 chip（ref = childId；label/clipboardText 供渲染与复制）。
      onPick: (pick: { candidate: { name: string } }, session: { sessionId?: string } | undefined) => {
        if (session?.sessionId === undefined) return undefined
        // 直连腿：按编号标题匹配 metaStore 记录（与 candidates 同源同序）。
        if (directNativeLeg(ctx)) {
          const meta = sideChatMetasOf(session.sessionId)
            .filter(m => m.childId !== undefined)
            .find(m => (m.number <= 1 ? t('tabBaseTitle') : `${t('tabBaseTitle')} ${m.number}`) === pick.candidate.name)
          if (meta?.childId === undefined) return undefined
          return {
            insert: {
              source: SOURCE,
              ref: meta.childId,
              label: pick.candidate.name,
              clipboardText: `@${pick.candidate.name}`,
            },
          }
        }
        const snapshot = ctx.betterSidebar?.getSnapshot()
        if (snapshot === undefined || snapshot.sessionId !== session.sessionId || snapshot.state === undefined) return undefined
        const tab = collectSideTabs(snapshot.state).find(tab => tab.title === pick.candidate.name)
        const childId = tab === undefined ? undefined : parseSideChatMeta(tab.meta).childId
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
