import type { Context, SessionInput } from './contracts.ts'
import { addInputAttachments } from './input.ts'

interface Preview { readonly id: string; readonly previewUrl: string }
interface Draft { readonly id: string; readonly kind: 'image' | 'file'; readonly previewUrl?: string }

/** Reuse the host's session-authorized image cache; never construct media URLs. */
export function contextImageLoader(ctx: Context, sessionId: string): ((attachment: unknown) => Promise<string>) | undefined {
  const service = ctx.get('uiConversation') as { imageUrl?(sessionId: string, attachment: unknown): Promise<string> } | undefined
  return service?.imageUrl ? attachment => service.imageUrl!(sessionId, attachment) : undefined
}

/** Image intake only; serialization and lifecycle stay owned by native submit. */
export interface AttachmentApis {
  createDraftImages(files: readonly File[]): readonly Preview[]
  draftImages(ids: readonly string[]): readonly Preview[]
  releaseDraftImage(id: string): void
}

export function resolveAttachmentApis(ctx: Context, sessionId?: string): AttachmentApis | null {
  const conv = ctx.get('conversation') as Partial<AttachmentApis> & {
    createDrafts?: (id: string, files: readonly File[]) => readonly Draft[]
    resolveDraftAttachments?: (ids: readonly string[]) => readonly Draft[]
    releaseDraftAttachment?: (id: string) => void
  } | undefined
  if (typeof conv?.createDrafts === 'function' && typeof conv.resolveDraftAttachments === 'function'
    && typeof conv.releaseDraftAttachment === 'function' && sessionId !== undefined) {
    const previews = (drafts: readonly Draft[]): readonly Preview[] => drafts
      .filter((draft): draft is Draft & Preview => draft.kind === 'image' && typeof draft.previewUrl === 'string')
    return {
      createDraftImages: files => previews(conv.createDrafts!(sessionId, files)),
      draftImages: ids => previews(conv.resolveDraftAttachments!(ids)),
      releaseDraftImage: id => conv.releaseDraftAttachment!(id),
    }
  }
  if (typeof conv?.createDraftImages !== 'function' || typeof conv.draftImages !== 'function' || typeof conv.releaseDraftImage !== 'function') return null
  return conv as AttachmentApis
}

export function attachFiles(apis: AttachmentApis, input: SessionInput, files: readonly File[]): boolean {
  const images = apis.createDraftImages(files)
  if (images.length === 0) return false
  if (addInputAttachments(input, images.map(image => image.id))) return true
  for (const image of images) apis.releaseDraftImage(image.id)
  return false
}
