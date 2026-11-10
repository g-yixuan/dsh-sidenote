import z from '@deepseek-ai/schemastery'

/** Live presentation preference stored in the host's profile document. */
export const Config = z.object({
  hideNativeQuote: z.boolean().default(true).volatile(),
  showSideChatNote: z.boolean().default(true).volatile(),
  finalRepliesDefaultAttempted: z.boolean().default(false).volatile(),
})
