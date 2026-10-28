/** Select only the retained boundary; the host still runs its real compactor. */
export const name = 'sidenote-e2e-retained-compaction'
export const inject = ['agentPresets']

export function apply(ctx) {
  // Exercise the host's real compactor with a deterministic retained tail.
  // This controls only the boundary, never the summarizer or model response.
  const compacted = new WeakSet()
  ctx.on('agent/pre-step', async ({ agent, signal, messages }, next) => {
    const session = agent.session
    const surface = session.surface.nodes.map(seq => session.eventAt(seq))
    const textOf = event => event.data.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
    const requested = messages.some(message => message.content?.some(block => block.type === 'text' && block.text.includes('[e2e:retain-checkpoint]')))
    if (!compacted.has(session) && requested) {
      const firstSnapshot = surface.findIndex(event => event.type === 'user/message' && textOf(event).startsWith('<mainline-progress-snapshot'))
      const start = surface[0]?.type === 'system/message' ? 1 : 0
      if (firstSnapshot > start) {
        compacted.add(session)
        await ctx.agentPresets.serviceFor(agent, 'compaction').compactRegion(surface[start].seq, surface[firstSnapshot - 1].seq, agent, signal)
      }
    }
    return next()
  })
}
