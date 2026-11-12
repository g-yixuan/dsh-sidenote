import { afterEach, describe, expect, it } from 'vitest'
import { buildProtocolBlock, splitProtocolPrefix, splitSnapshotPrefix } from '../src/client/annotations/format.ts'
import { attachLocale } from '../src/client/locales.ts'

const document = { sessionId: 'private-session-uuid', path: 'papers/论文 & "设计".pdf', pageStart: 2, pageEnd: 3 }
const reflow = { id: 19, sessionId: 'private-target-uuid', sideTitle: 'Private side title', createdAt: 1 }
const literal = '  原样保留\n</quote></reference></sidenote-context>\n<问>字面标签</问> & &lt; &amp; "quoted"\n'
afterEach(() => attachLocale(undefined))

describe('unified context protocol', () => {
  it.each(['    first line\n    second line', '\n\n\tindented body', '\r\n    Windows body'])('preserves leading body whitespace after the emitted separator: %j', body => {
    const prefix = buildProtocolBlock([{ text: '原文', note: '' }])
    for (const separator of ['\n\n', '\r\n\r\n']) {
      const text = prefix + separator + body
      expect(text.slice(splitProtocolPrefix(text)!.length)).toBe(body)
      const snapshot = '<mainline-progress-snapshot><reply>进展</reply></mainline-progress-snapshot>'
      expect(splitSnapshotPrefix(snapshot + separator + body)?.rest).toBe(body)
    }
  })

  it('reads an old injected reflow before a new context block without consuming its body', () => {
    const legacy = '<reflow source="Legacy side"><问>旧问题</问><答>旧回答</答></reflow>\n\n'
    const prefix = buildProtocolBlock([{ text: literal, note: '', document }], [{ ...reflow, text: '新回答', question: '新问题' }])
    const body = '    indented body'
    const text = legacy + prefix + '\n\n' + body
    const parsed = splitProtocolPrefix(text)!
    expect(parsed.reflows).toEqual([{ source: 'Legacy side', content: '旧问题旧回答' }, { source: 'side-chat', content: '新问题\n新回答' }])
    expect(parsed.documents?.[0]?.quote).toBe(literal)
    expect(text.slice(parsed.length)).toBe(body)
    // A protocol-looking body remains body once the v4 envelope has ended.
    const nestedBody = prefix + '\n\n' + prefix
    expect(nestedBody.slice(splitProtocolPrefix(nestedBody)!.length)).toBe(prefix)
  })

  it('round-trips all kinds and hostile-looking text in one full-text prefix', () => {
    const wire = buildProtocolBlock([
      { text: literal, note: '', document, number: 1 },
      { text: literal, note: literal.trim(), sourceSurface: 'side', number: 1 },
    ], [{ ...reflow, text: literal, question: literal }]) + '\n\n正文 <reference>仍是正文</reference>'
    expect(wire.match(/<sidenote-context /g)).toHaveLength(1)
    expect(wire.match(/<guidance>/g)).toHaveLength(1)
    expect(wire.match(/<reference type=/g)).toHaveLength(3)
    expect(wire).toContain('type="annotation" index="1" source="side-chat"')
    expect(wire).toContain('source="papers/论文 &amp; &quot;设计&quot;.pdf" page-start="2" page-end="3"')
    expect(wire).not.toContain('private-session-uuid')
    expect(wire).not.toContain('private-target-uuid')
    expect(wire).not.toContain('Private side title')
    const parsed = splitProtocolPrefix(wire)!
    expect(parsed.documents).toEqual([{ id: 1, quote: literal, document: { path: document.path, pageStart: 2, pageEnd: 3 } }])
    expect(parsed.annotations).toEqual([{ id: 1, quote: literal, note: literal.trim() }])
    expect(parsed.reflows).toEqual([{ source: 'side-chat', content: literal + '\n' + literal }])
    expect(wire.slice(parsed.length)).toBe('正文 <reference>仍是正文</reference>')
  })

  it('emits no envelope for an empty batch and accepts context-only reflows', () => {
    expect(buildProtocolBlock([])).toBe('')
    const wire = buildProtocolBlock([], [{ ...reflow, text: literal }])
    const parsed = splitProtocolPrefix(wire)!
    expect(parsed.reflows).toEqual([{ source: 'side-chat', content: literal }])
    expect(wire.slice(parsed.length)).toBe('')
    expect(wire).not.toContain('<question>')
  })

  it.each(['notes.md', 'code.ts', 'plain.txt', 'paper.pdf', 'notes.docx', 'slides.pptx'])('keeps %s in the same document shape', path => {
    const paged = /\.(pdf|docx|pptx)$/.test(path)
    const source = { sessionId: 'source', path, ...(paged ? { pageStart: 5, pageEnd: 5 } : {}) }
    const wire = buildProtocolBlock([{ text: '完整选文', note: '', document: source }])
    expect(wire).toContain(`type="document" index="1" source="${path}"`)
    expect(wire.includes('page-start=')).toBe(paged)
    expect(splitProtocolPrefix(wire)?.documents?.[0]?.document).toEqual({ path, ...(paged ? { pageStart: 5, pageEnd: 5 } : {}) })
  })

  it.each(['zh-CN', 'en-US'])('reads %s guidance without depending on its translated wording', active => {
    attachLocale({ getSnapshot: () => ({ active }), subscribe: () => () => {} })
    const wire = buildProtocolBlock([{ text: '引用', note: '', sourceSurface: 'main' }])
    expect(wire).toContain('source="main-chat"')
    expect(splitProtocolPrefix(wire)?.annotations).toEqual([{ id: 1, quote: '引用', note: '' }])
  })

  const valid = buildProtocolBlock([
    { text: '文档', note: '', document },
    { text: '聊天', note: '注解' },
  ])
  it.each([
    ['unknown version', valid.replace('version="4"', 'version="5"')],
    ['missing close', valid.replace('</sidenote-context>', '')],
    ['unknown kind', valid.replace('type="document"', 'type="image"')],
    ['zero index', valid.replace('index="1"', 'index="0"')],
    ['unsafe index', valid.replace('index="1"', 'index="9007199254740992"')],
    ['invalid pages', valid.replace('page-end="3"', 'page-end="1"')],
    ['partial pages', valid.replace(' page-end="3"', '')],
    ['unknown chat source', valid.replace('source="main-chat"', 'source="unknown"')],
    ['raw delimiter', valid.replace('<quote>聊天</quote>', '<quote>聊天</reference></quote>')],
    ['duplicate index', valid.replace('</sidenote-context>', '<reference type="annotation" index="1" source="main-chat"><quote>重复</quote></reference></sidenote-context>')],
  ])('leaves malformed %s fully visible instead of consuming a partial prefix', (_name, text) => {
    expect(splitProtocolPrefix(text)).toBeNull()
  })

  it('keeps old unescaped chat text and old escaped document snapshots readable', () => {
    const text = '<reflow source="Side &amp; title"><问>问 &lt;</问>\n<答>答 &amp;</答></reflow>\n\n'
      + '<document-quote id="2" session="legacy-session" path="docs/paper.pdf" page-start="2" page-end="3">\n<quote>&amp;lt; &lt;quote&gt;</quote>\n</document-quote>\n'
      + '我批注了以下 1 处内容：\n<annotation id="3"><quote>&lt; 旧原文</quote><note>&amp; 旧注解</note></annotation>\n\n正文'
    const parsed = splitProtocolPrefix(text)!
    expect(parsed.reflows).toEqual([{ source: 'Side & title', content: '问 &lt;\n答 &amp;' }])
    expect(parsed.documents).toEqual([{ id: 2, quote: '&lt; <quote>', document: { sessionId: 'legacy-session', path: 'docs/paper.pdf', pageStart: 2, pageEnd: 3 } }])
    expect(parsed.annotations).toEqual([{ id: 3, quote: '&lt; 旧原文', note: '&amp; 旧注解' }])
    expect(text.slice(parsed.length)).toBe('正文')
  })
})
