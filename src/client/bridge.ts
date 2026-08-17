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
}

export const sideChatBridge: { current: SideChatBridge | null } = { current: null }
