/** Passive metadata only: no headers, prompts, tool arguments or response text.
 * Requests go directly from the native adapter to the official API unchanged. */
import { writeFileSync } from 'node:fs'
export const name = 'sidenote-e2e-official-wire'
export function apply(ctx, config) {
  const records = []
  ctx.effect(() => {
    const original = globalThis.fetch
    const write = () => writeFileSync(config.output, JSON.stringify(records, null, 2) + '\n')
    globalThis.fetch = async function (url, init) {
      if (!String(url).startsWith('https://api.deepseek.com/') || typeof init?.body !== 'string') return original.call(this, url, init)
      const body = JSON.parse(init.body)
      const lastUser = body.messages?.findLast(message => message.role === 'user')
      const lastUserImageCount = Array.isArray(lastUser?.content) ? lastUser.content.filter(block => block.type === 'image_url').length : 0
      const record = { model: body.model, thinking: body.thinking ?? null, reasoningEffort: body.reasoning_effort ?? null, reasoningCharacters: 0, toolDeltas: 0, lastUserImageCount }
      records.push(record)
      const response = await original.call(this, url, init)
      record.status = response.status
      write()
      void (async () => {
        let pending = ''
        for await (const chunk of response.clone().body) {
          pending += Buffer.from(chunk).toString('utf8')
          const lines = pending.split('\n'); pending = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
            const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta
            record.reasoningCharacters += delta?.reasoning_content?.length ?? 0
            record.toolDeltas += delta?.tool_calls?.length ?? 0
          }
        }
        record.finished = true
        write()
      })().catch(() => { record.observationFailed = true; write() })
      return response
    }
    return () => { globalThis.fetch = original }
  })
}
