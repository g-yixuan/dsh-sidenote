/** Synthetic provider at the published LlmAdapter boundary. No input, Session,
 * transport, admission, queue, attachment or event projection is replaced. */
export const name = 'sidenote-e2e-model'
export const inject = ['llm']

// Keep a real turn pending until it is stopped, with an upper bound for failures.
function holdResponse(signal, duration = 40_000) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, duration)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

// Match the human instruction separately from its inherited context, just as
// the real-model lane must do. Keep the full messages for history assertions.
function questionBody(text) {
  const end = text.indexOf('</mainline-progress-snapshot>')
  return text.startsWith('<mainline-progress-snapshot') && end >= 0 ? text.slice(end + '</mainline-progress-snapshot>'.length).trimStart() : text
}

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
      if (options.messages.at(-1)?.source === undefined && options.messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('[e2e:slow-compact]')))) await holdResponse(options.signal, 15_000)
      // Context producers also use role=user; only source=user is human input.
      const users = options.messages.filter(message => message.role === 'user' && message.source?.kind === 'user')
      const last = users.at(-1)?.content ?? []
      const text = questionBody(last.filter(block => block.type === 'text').map(block => block.text).join('\n'))
      // An image-only request can have no textual progress before its first token.
      if (text.trim() === '' && last.some(block => block.type === 'image')) await holdResponse(options.signal)
      const lastHuman = options.messages.findLastIndex(message => message.role === 'user' && message.source?.kind === 'user')
      const hasToolResult = options.messages.slice(lastHuman + 1).some(message => message.source?.kind === 'tool')
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
        const remembered = users.some(message => message.content.some(block => block.type === 'text' && questionBody(block.text) === '[e2e:reflow] Remember the conclusion code SIDENOTE_SIDE_BLUE.'))
        const priorReply = options.messages.some(message => message.role === 'assistant' && message.content.some(block => block.type === 'text' && block.text === 'Remembered SIDENOTE_SIDE_BLUE in this side conversation.'))
        reply = remembered && priorReply ? 'Conclusion: SIDENOTE_SIDE_BLUE.' : 'The prior side-conversation context is missing.'
      } else if (text.endsWith('Use the returned side conclusion in this main conversation.')) {
        const returned = options.messages.some(message => message.role === 'user' && message.source?.kind === 'user' && message.content.some(block => block.type === 'text' && block.text.includes('<答>Conclusion: SIDENOTE_SIDE_BLUE.</答>')))
        reply = returned ? 'Main received SIDENOTE_SIDE_BLUE.' : 'The returned side-conversation context is missing.'
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      if (text.trimEnd().endsWith('[e2e:progress-stream]')) for (let i = 1; i <= 40; i++) {
        await holdResponse(options.signal, 600)
        const delta = `\n\nLive progress ${i}: a new step in the running main conversation.`
        reply += delta
        yield { type: 'text-delta', index: 0, text: delta }
      }
      if (text.trimEnd().endsWith('[e2e:steer-window]')) await holdResponse(options.signal, 4_000)
      if (text.trimEnd().endsWith('[e2e:hold]')) await holdResponse(options.signal)
      options.signal?.throwIfAborted()
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  ctx.effect(() => ctx.llm.registerAdapter([provider], adapter))
}
