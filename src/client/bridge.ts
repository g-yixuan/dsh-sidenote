/**
 * In-plugin bridge between the annotate module (Workitem 02/03) and the
 * sidechat module (Workitem 01). The sidechat module installs an
 * implementation on activation; annotate's 「在侧边聊天中提问」 button calls
 * it when present. Module-level singleton by design: exactly one sidechat
 * module and one annotate module exist per activation.
 */
import type { SessionId } from '../context-types.ts'

export interface SideChatBridge {
  /**
   * Open (or focus) a side chat forked from `sessionId`, seeding its composer
   * draft with `draftText` (quoted selection + annotation). Returns false
   * when no side chat could be opened (caller keeps its own flow).
   */
  askInSideChat(sessionId: SessionId, draftText: string): boolean
  /**
   * 预览 askInSideChat 此刻会落到哪个侧边聊天 Tab 的标题（编辑器上标明
   * 「发送至：侧边 N」）；目标不可预知时返回 undefined。
   */
  peekTargetTitle(sessionId: SessionId): string | undefined
}

export const sideChatBridge: { current: SideChatBridge | null } = { current: null }
