/**
 * In-plugin bridge between the annotate module (Workitem 02/03) and the
 * sidechat module (Workitem 01). The sidechat module installs an
 * implementation on activation; annotate's 「在侧边聊天中提问」 button calls
 * it when present. Module-level singleton by design: exactly one sidechat
 * module and one annotate module exist per activation.
 */
import type { SessionId } from './host/contracts.ts'

export interface SideChatBridge {
  captureTarget(sessionId: SessionId): {
    title?: string
    resolve(signal: AbortSignal): Promise<{ childId: string; title: string; isOpen(): boolean }>
  }
}

export const sideChatBridge: { current: SideChatBridge | null } = { current: null }
