import type { Context, SessionInput } from './contracts.ts'
import { addInputAttachments } from './input.ts'
import { imageId } from '../../snapshotProtocol.ts'

export interface ContextImages { sessionId: string; attachments: readonly unknown[] }

/** Re-admit canonical host bytes through the native attachment transaction. */
export async function prepareContextImages(ctx: Context, targetId: string, images: ContextImages) {
  const load = contextImageLoader(ctx, images.sessionId)
  const apis = resolveAttachmentApis(ctx, targetId)
  if (!load || !apis) throw new Error('无法继承主线图片，内容已保留，请重试')
  const unique = new Map(images.attachments.map(attachment => [imageId(attachment), attachment]))
  const files = await Promise.all([...unique.values()].map(async (attachment, index) => {
    const response = await fetch(await load(attachment))
    if (!response.ok) throw new Error('加载主线图片失败，内容已保留，请重试')
    const blob = await response.blob()
    const ref = attachment as { name?: string; mediaType?: string }
    return new File([blob], ref.name ?? `context-${index + 1}`, { type: ref.mediaType ?? blob.type })
  }))
  const drafts = apis.createDraftImages(files)
  const release = () => { for (const draft of drafts) apis.releaseDraftImage(draft.id) }
  if (drafts.length !== files.length) { release(); throw new Error('无法完整继承主线图片，内容已保留') }
  return { ids: drafts.map(draft => draft.id), release }
}

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
