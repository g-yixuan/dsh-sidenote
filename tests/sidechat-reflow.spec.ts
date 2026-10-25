import { describe, expect, it } from 'vitest'
import { addReply, finalReplies, isReplyAdded, type SideConversation } from '../src/client/sidechat/NativeConversation.tsx'
import { createReflowStore } from '../src/client/reflow.ts'
import { nodeToMessage, type ChatMessage } from '../src/client/chat/transcript.ts'
import { pairQuestions } from '../src/client/sidechat/model.ts'

const message = (role: ChatMessage['role'], text: string, seq: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ role, text, seq, key: String(seq), ...extra })
describe('fork-local final answers', () => {
  it('reflows the question without duplicating a busy-fork progress snapshot', () => {
    const question = '<mainline-progress-snapshot taken-at="now">inherited progress</mainline-progress-snapshot>\n\nactual question'
    expect(pairQuestions([message('user', question, 3), message('assistant', 'final', 4)]).get('4')).toBe('actual question')
  })
  it('reflows an image question without returning its inherited progress as question text', () => {
    const question = nodeToMessage({ kind: 'user', seq: 3, content: [
      { type: 'image' },
      { type: 'text', text: '<mainline-progress-snapshot taken-at="now">inherited progress</mainline-progress-snapshot>\n\nactual image question' },
    ] })!
    expect(pairQuestions([question, message('assistant', 'final', 4)]).get('4')).toBe('actual image question')
  })
  it('does not return inherited or intermediate answers', () => {
    expect(finalReplies([
      message('user', 'old', 1), message('assistant', 'inherited', 2),
      message('user', 'new question', 3), message('assistant', 'I will check', 4), message('tool', 'result', 5), message('assistant', 'final answer', 6),
    ], 2).map(reply => reply.text)).toEqual(['final answer'])
    expect(finalReplies([message('assistant', 'inherited', 2)], 2)).toEqual([])
  })
  it('excludes in-flight, interrupted and failed work', () => {
    for (const extra of [{ streaming: true }, { interrupted: true }]) expect(finalReplies([message('user', 'q', 3), message('assistant', 'unfinished', 4, extra)], 2)).toEqual([])
    expect(finalReplies([message('user', 'q', 3), message('assistant', 'process', 4), message('error', 'failed', 5)], 2)).toEqual([])
    expect(finalReplies([message('user', 'q', 3), message('assistant', 'settled process before cancelled tool', 4)], 2, new Set())).toEqual([])
    expect(finalReplies([message('user', 'q', 3), message('assistant', 'completed final', 4)], 2, new Set([4]))).toHaveLength(1)
  })
  it('uses durable source identity and reflects removal without merging identical later answers', () => {
    const side: SideConversation = { sessionId: 'child', parentSessionId: 'parent', title: 'Side', reflow: createReflowStore(() => 1, null) }
    const first = message('assistant', 'same answer', 4)
    addReply(side, first, 'same question'); addReply(side, first, 'same question')
    expect(side.reflow.list('parent')).toHaveLength(1)
    expect(isReplyAdded({ ...side, title: 'renamed' }, first)).toBe(true)
    addReply(side, message('assistant', 'same answer', 8), 'same question')
    expect(side.reflow.list('parent')).toHaveLength(2)
    side.reflow.remove(side.reflow.list('parent')[0]!.id)
    expect(isReplyAdded(side, first, 'same question')).toBe(false)
    addReply(side, first, 'same question')
    expect(side.reflow.list('parent')).toHaveLength(2)
  })
})
