import type { ContextImages } from '../host/attachments.ts'
/** Extra context belongs to one mounted conversation; the native input still owns submission. */
export interface SubmissionExtras {
  needsFirstSend(): boolean
  firstSendPrefix(): Promise<SubmissionContext | null>
  onAccepted(): void
  onSubmitText(body: string): void
}
const extras = new Map<string, SubmissionExtras>()
export function submissionExtrasOf(sessionId: string): SubmissionExtras | undefined { return extras.get(sessionId) }
export function registerSubmissionExtras(sessionId: string, value: SubmissionExtras): () => void {
  extras.set(sessionId, value)
  return () => { if (extras.get(sessionId) === value) extras.delete(sessionId) }
}
export interface SubmissionContext { text: string; images?: ContextImages }
