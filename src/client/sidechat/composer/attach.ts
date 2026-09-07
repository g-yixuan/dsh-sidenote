/**
 * 附件（图片）通道（WI-02）：composer 附件按钮 → 文件选择 →
 * conversation.createDraftImages（off-face 具体类方法，feature-check）→
 * input.addImages(ids) 进输入机器；rail 显示待发缩略图 + 单张移除。
 *
 * 数据面事实（D3-host-recon F10）：createDraftImages/draftImages/
 * serializeDraftImages 在 ConversationController 具体类上（IConversation
 * 契约不含——off-face，缺失时附件按钮不渲染）。提交时机/释放由输入机器负责
 * （与主对话同事务）。
 */
import type { Context, SessionInput } from '../../host/contracts.ts'

/** 附件能力的运行时面（off-face 探测目标；previewUrl 供 rail 缩略图）。 */
export interface AttachmentApis {
  createDraftImages(files: readonly File[]): readonly { id: string; previewUrl: string }[]
  /** 由 id 解析运行态草稿图片（rail 显示用）。 */
  draftImages(ids: readonly string[]): readonly { id: string; previewUrl: string }[]
  releaseDraftImage(id: string): void
}

/** 解析附件 API（缺失返回 null → 调用点不渲染附件入口）。 */
export function resolveAttachmentApis(ctx: Context): AttachmentApis | null {
  try {
    const conv = ctx.get('conversation') as unknown as AttachmentApis | undefined
    if (typeof conv?.createDraftImages !== 'function'
      || typeof conv?.draftImages !== 'function'
      || typeof conv?.releaseDraftImage !== 'function') return null
    return conv
  } catch {
    return null
  }
}

/** 选中文件 → 注册为草稿图片并挂进输入机器；返回是否成功挂上。 */
export function attachFiles(apis: AttachmentApis, input: SessionInput, files: readonly File[]): boolean {
  try {
    const images = apis.createDraftImages(files)
    if (images.length === 0) return false
    return input.addImages(images.map(i => i.id))
  } catch (error) {
    console.warn('[dsh-sidenote] 附件注册失败:', error)
    return false
  }
}
