// @vitest-environment jsdom
/**
 * 内容身份（Delivery_05）单测：
 * - topicOf：首条消息 → topic（空白折叠 / 20 码点截断 / CJK 安全 / 空回退）；
 * - sideChatTitleOf：topic 优先、编号回退——全部标题面的唯一计算源；
 * - formatClosedAt：相对时间五档（刚刚/分钟/小时/昨天/日期）；
 * - recentClosed：topic 随条目往返、老条目（无 topic）兼容；
 * - dedupeName：@引用候选重名消歧。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { formatClosedAt, sideChatTitleOf, topicOf } from '../src/client/sidechat/identity.ts'
import { listClosedSideChats, recordClosedSideChat } from '../src/client/sidechat/recentClosed.ts'
import { dedupeName } from '../src/client/sidechat/referenceSource.ts'
import { xmlAttr } from '../src/client/protocol.ts'

describe('topicOf（首条消息 → 内容身份）', () => {
  it('折叠多行与连续空白为单空格', () => {
    expect(topicOf('部署泳道\n为啥   又挂了？\n\n查一下')).toBe('部署泳道 为啥 又挂了？ 查一下')
  })

  it('超 20 码点截断加省略号，CJK 按字不按字节', () => {
    const long = '这是一条非常非常长的首条消息用来验证截断逻辑是否按码点工作'
    const topic = topicOf(long)
    expect(topic).toBe('这是一条非常非常长的首条消息用来验证截断…')
    expect(Array.from(topic!).length).toBe(21)
  })

  it('恰 20 码点不加省略号；emoji 算一码点', () => {
    expect(topicOf('一二三四五六七八九十一二三四五六七八九十')).toBe('一二三四五六七八九十一二三四五六七八九十')
    const emoji = '🙂'.repeat(21)
    expect(Array.from(topicOf(emoji)!).length).toBe(21)
  })

  it('纯空白/空串 → undefined（回退编号标题）', () => {
    expect(topicOf('   \n\t  ')).toBeUndefined()
    expect(topicOf('')).toBeUndefined()
  })

  it('划选提问草稿：剥引用行取用户自己的话（L3）', () => {
    expect(topicOf('> func foo() {\n>   return 1\nNote: 这里没判空\n这个判空该加在哪')).toBe('Note: 这里没判空 这个判空该加在哪')
  })

  it('划选提问草稿：只有引用和占位注解时，引用内容即主题（L3）', () => {
    expect(topicOf('> const x = await fetch(url)\n(no note)')).toBe('const x = await fetc…')
    expect(topicOf('> 只有一行引用')).toBe('只有一行引用')
  })
})

describe('sideChatTitleOf（标题唯一计算源）', () => {
  it('topic 优先：编号在时也不参与', () => {
    expect(sideChatTitleOf({ number: 3, topic: '部署泳道排查' })).toBe('Side · 部署泳道排查')
  })

  it('无 topic 回退编号：1 号不显式编号', () => {
    expect(sideChatTitleOf({ number: 1 })).toBe('Side')
    expect(sideChatTitleOf({ number: 2 })).toBe('Side 2')
  })

  it('meta 缺失 / topic 空串 → 基础标题', () => {
    expect(sideChatTitleOf(undefined)).toBe('Side')
    expect(sideChatTitleOf({ number: 2, topic: '' })).toBe('Side 2')
  })
})

describe('formatClosedAt（相对关闭时间）', () => {
  const now = new Date('2026-09-23T15:00:00').getTime()

  it('五档边界：刚刚 / 分钟 / 小时 / 昨天 / 日期', () => {
    expect(formatClosedAt(now - 30_000, now)).toBe('Closed just now')
    expect(formatClosedAt(now - 5 * 60_000, now)).toBe('Closed 5 min ago')
    expect(formatClosedAt(now - 3 * 3_600_000, now)).toBe('Closed 3h ago')
    expect(formatClosedAt(new Date('2026-09-22T23:30:00').getTime(), now)).toBe('Closed yesterday')
    expect(formatClosedAt(new Date('2026-09-10T10:00:00').getTime(), now)).toBe('Closed 9/10')
  })

  it('跨年带年份', () => {
    expect(formatClosedAt(new Date('2025-12-30T10:00:00').getTime(), now)).toBe('Closed 2025/12/30')
  })

  it('DST 拨快日：「昨天」按日历运算不按毫秒（L1 回归）', () => {
    const prev = process.env.TZ
    process.env.TZ = 'Europe/Berlin'
    try {
      // 2025-03-30 是 Berlin 的 23 小时日；now - 86400000 会落到前天。
      const berlinNow = new Date('2025-03-31T00:30:00').getTime()
      const closedAt = new Date('2025-03-30T12:00:00').getTime()
      expect(formatClosedAt(closedAt, berlinNow)).toBe('Closed yesterday')
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  })
})

describe('recentClosed（关闭登记携带 topic）', () => {
  beforeEach(() => localStorage.clear())

  const entry = (childId: string, extra?: { topic?: string }) => ({
    childId,
    parentSessionId: 'p1',
    title: '侧边',
    closedAt: 1_000,
    ...extra,
  })

  it('topic 随条目写入并读回；新者在前', () => {
    recordClosedSideChat('p1', entry('c1', { topic: '部署泳道排查' }))
    recordClosedSideChat('p1', entry('c2', { topic: 'fork 边界' }))
    const list = listClosedSideChats('p1')
    expect(list.map(e => e.childId)).toEqual(['c2', 'c1'])
    expect(list[1]?.topic).toBe('部署泳道排查')
  })

  it('老条目无 topic 字段仍可读（revive 兼容）', () => {
    localStorage.setItem(
      'dsh-sidenote:closed-side:v1:p1',
      JSON.stringify([{ childId: 'c9', parentSessionId: 'p1', title: '侧边 2', closedAt: 500 }]),
    )
    const list = listClosedSideChats('p1')
    expect(list[0]?.topic).toBeUndefined()
    expect(list[0]?.title).toBe('侧边 2')
  })
})

describe('xmlAttr（协议块属性位转义，M3）', () => {
  it('引号/尖括号/& 全部转义；普通文本原样', () => {
    expect(xmlAttr('侧边 · 对比 "a" 和 "b"')).toBe('侧边 · 对比 &quot;a&quot; 和 &quot;b&quot;')
    expect(xmlAttr('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d')
    expect(xmlAttr('部署泳道排查')).toBe('部署泳道排查')
  })
})

describe('dedupeName（@引用候选重名消歧）', () => {
  it('不重名原样；重名追加序号；序号本身撞名继续递增', () => {
    const taken = new Set<string>()
    expect(dedupeName('侧边 · 部署', taken)).toBe('侧边 · 部署')
    expect(dedupeName('侧边 · 部署', taken)).toBe('侧边 · 部署 · 2')
    expect(dedupeName('侧边 · 部署', taken)).toBe('侧边 · 部署 · 3')
    expect(dedupeName('侧边 · 部署 · 2', taken)).toBe('侧边 · 部署 · 2 · 2')
  })
})

describe('setSideChatTopic sticky（L2：守卫沉在 mutate，不依赖调用方相位）', () => {
  beforeEach(() => localStorage.clear())

  it('第二次写入不覆盖已有 topic', async () => {
    const { setSideChatTopic } = await import('../src/client/sidechat/lifecycle.ts')
    const { writeSideChatMeta, readSideChatMeta } = await import('../src/client/sidechat/metaStore.ts')
    const ctx = { get: () => undefined } as never // BS 缺席 → 直连腿（metaStore 路径）
    writeSideChatMeta({ tabId: 't1', sessionId: 's1', number: 1, createdAt: 1 }, { silent: true })
    setSideChatTopic(ctx, 's1', 't1', '第一主题')
    setSideChatTopic(ctx, 's1', 't1', '第二主题')
    expect(readSideChatMeta('s1', 't1')?.topic).toBe('第一主题')
  })
})
