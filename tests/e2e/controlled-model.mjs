/** Synthetic provider at the published LlmAdapter boundary. No input, Session,
 * transport, admission, queue, attachment or event projection is replaced. */
export const name = 'sidenote-e2e-model'
export const inject = ['llm']

export function apply(ctx) {
  const provider = 'sidenote-e2e'
  const model = { provider, id: 'controlled', name: 'Controlled E2E', inputModalities: ['text', 'image'], context: { contextWindow: 32768 }, defaultMaxTokens: 128 }
  const adapter = {
    providerInfo: id => ({ id, name: 'Sidenote E2E' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async () => [model],
    resolveModel: async () => model,
    async prepareCall() { return { model, stream: options => this.stream(options) } },
    async *stream(options) {
      options.signal?.throwIfAborted()
      // Context producers also use role=user; only source=user is human input.
      const users = options.messages.filter(message => message.role === 'user' && message.source.kind === 'user')
      const last = users.at(-1)?.content ?? []
      const text = last.filter(block => block.type === 'text').map(block => block.text).join('\n')
      const lastHuman = options.messages.findLastIndex(message => message.role === 'user' && message.source.kind === 'user')
      const hasToolResult = options.messages.slice(lastHuman + 1).some(message => message.source.kind === 'tool')
      let call
      if (!hasToolResult && text.includes('[e2e:question]')) call = { name: 'ask_user_question', arguments: { questions: [{ id: 'layout', question: 'Which native layout should we use?', options: [{ label: 'Compact', description: 'Keep the narrow sidebar' }, { label: 'Spacious', description: 'Use more space' }] }] } }
      if (!hasToolResult && text.includes('[e2e:approval]')) call = { name: 'bash', arguments: { description: 'Write isolated E2E marker', command: "printf 'approved native side tool\\n' > ../approval-target.txt", sandbox_permissions: 'danger-full-access', justification: 'Create only the isolated E2E marker after explicit approval.' } }
      if (!hasToolResult && text.includes('[e2e:long-tool]')) call = { name: 'read', arguments: { file_path: 'long-tool.txt' } }
      if (call) {
        const block = { type: 'tool-call', id: 'sidenote-e2e-' + lastHuman, name: call.name, arguments: JSON.stringify(call.arguments) }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      let reply = 'Controlled E2E reply. This complete assistant response supports quote selection.\n\nSecond paragraph preserves the full selected text.'
      if (text === '[e2e:reflow] Remember the conclusion code SIDENOTE_SIDE_BLUE.') {
        reply = 'Remembered SIDENOTE_SIDE_BLUE in this side conversation.'
      } else if (text === '[e2e:reflow] Return the remembered code as the final conclusion.') {
        const remembered = users.some(message => message.content.some(block => block.type === 'text' && block.text === '[e2e:reflow] Remember the conclusion code SIDENOTE_SIDE_BLUE.'))
        const priorReply = options.messages.some(message => message.role === 'assistant' && message.content.some(block => block.type === 'text' && block.text === 'Remembered SIDENOTE_SIDE_BLUE in this side conversation.'))
        reply = remembered && priorReply ? 'Conclusion: SIDENOTE_SIDE_BLUE.' : 'The prior side-conversation context is missing.'
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      if (text.trimEnd().endsWith('[e2e:hold]')) {
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(options.signal.reason) }
          const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve() }, 40_000)
          if (options.signal?.aborted) abort()
          else options.signal?.addEventListener('abort', abort, { once: true })
        })
      }
      options.signal?.throwIfAborted()
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
}
