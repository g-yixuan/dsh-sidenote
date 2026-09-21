// @vitest-environment jsdom
/**
 * metaStore（自有 meta 持久化）+ native-tab 纯逻辑（openParams 解析 /
 * reconcile 落库 / 编号标题）。jsdom 环境自带 localStorage；每个用例前清场。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  dropSideChatMeta,
  nextSideChatNumber,
  readSideChatMeta,
  sideChatMetasOf,
  writeSideChatMeta,
} from '../src/client/sidechat/metaStore.ts'
import { parseOpenParams, reconcileMeta, titleOf } from '../src/client/sidechat/native-tab.tsx'
import type { NativeTabRecord } from '../src/client/host/contracts.ts'

function meta(partial: Partial<Parameters<typeof writeSideChatMeta>[0]> & { tabId: string, sessionId: string }) {
  return { number: 1, createdAt: 1, ...partial }
}

function tabRecord(id: string, params?: unknown): NativeTabRecord {
  return {
    id,
    kind: 'dsh-sidenote:side',
    title: '侧边',
    visible: true,
    navigation: { address: `sidebar://dsh-sidenote:side`, ...(params === undefined ? {} : { params }) },
    signal: new AbortController().signal,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('metaStore', () => {
  it('writes and reads back a record', () => {
    writeSideChatMeta(meta({ tabId: 't1', sessionId: 's1', childId: 'c1', boundarySeq: 7 }))
    expect(readSideChatMeta('s1', 't1')).toMatchObject({ tabId: 't1', sessionId: 's1', childId: 'c1', boundarySeq: 7, number: 1 })
  })

  it('drops a record and revives nothing from corrupt payloads', () => {
    writeSideChatMeta(meta({ tabId: 't1', sessionId: 's1' }))
    dropSideChatMeta('s1', 't1')
    expect(readSideChatMeta('s1', 't1')).toBeUndefined()
    localStorage.setItem('dsh-sidenote:side-meta:v1:t2', '{"sessionId":123}')
    expect(readSideChatMeta('s1', 't2')).toBeUndefined()
  })

  it('enumerates one session’s records in creation order; numbers run from max+1', () => {
    writeSideChatMeta(meta({ tabId: 't1', sessionId: 's1', createdAt: 2 }))
    writeSideChatMeta(meta({ tabId: 't2', sessionId: 's1', number: 2, createdAt: 1 }))
    writeSideChatMeta(meta({ tabId: 't3', sessionId: 's2' }))
    expect(sideChatMetasOf('s1').map(r => r.tabId)).toEqual(['t2', 't1'])
    expect(nextSideChatNumber('s1')).toBe(3)
    expect(nextSideChatNumber('s2')).toBe(2)
    expect(nextSideChatNumber('s3')).toBe(1)
  })
})

describe('parseOpenParams', () => {
  it('accepts a full payload and drops empty/unknown fields', () => {
    expect(parseOpenParams({ parentSessionId: 's1', pendingDraft: 'd', childId: 'c1', junk: 1 }))
      .toEqual({ parentSessionId: 's1', pendingDraft: 'd', childId: 'c1' })
  })

  it('rejects missing/empty parentSessionId and non-objects', () => {
    expect(parseOpenParams(undefined)).toBeUndefined()
    expect(parseOpenParams({ pendingDraft: 'd' })).toBeUndefined()
    expect(parseOpenParams({ parentSessionId: '' })).toBeUndefined()
  })
})

describe('reconcileMeta', () => {
  it('plants params into the store on first mount; second mount is a no-op', () => {
    const tab = tabRecord('t1', { parentSessionId: 'p1', childId: 'c1', pendingDraft: 'hello' })
    expect(reconcileMeta(tab, 'p1').created).toBe(true)
    expect(readSideChatMeta('p1', 't1')).toMatchObject({ sessionId: 'p1', childId: 'c1', parentSessionId: 'p1', pendingDraft: 'hello', number: 1 })
    // 幂等：重挂载不覆盖（fork 完成后登记的 childId 不被 params 重置）。
    expect(reconcileMeta(tabRecord('t1', { parentSessionId: 'p1' }), 'p1').created).toBe(false)
    expect(readSideChatMeta('p1', 't1')?.childId).toBe('c1')
  })

  it('falls back to the slot session when params are absent', () => {
    reconcileMeta(tabRecord('t9'), 's9')
    expect(readSideChatMeta('s9', 't9')).toMatchObject({ sessionId: 's9', parentSessionId: 's9', number: 1 })
  })

  it('跨会话同 tabId 不碰撞（宿主 tab id 是每会话独立计数器铸造）', () => {
    reconcileMeta(tabRecord('tab2'), 'sess-A')
    reconcileMeta(tabRecord('tab2'), 'sess-B')
    expect(readSideChatMeta('sess-A', 'tab2')?.sessionId).toBe('sess-A')
    expect(readSideChatMeta('sess-B', 'tab2')?.sessionId).toBe('sess-B')
    // 互不干扰：删 B 的记录不影响 A
    dropSideChatMeta('sess-B', 'tab2')
    expect(readSideChatMeta('sess-A', 'tab2')).toBeDefined()
  })
})

describe('titleOf', () => {
  it('is the base title without meta or at number 1, numbered beyond', () => {
    // 测试环境无宿主 locale，t() 落默认英文（"Side"/"Side N"）。
    expect(titleOf('s1', 'missing')).toBe('Side')
    writeSideChatMeta(meta({ tabId: 't1', sessionId: 's1', number: 1 }))
    expect(titleOf('s1', 't1')).toBe('Side')
    writeSideChatMeta(meta({ tabId: 't2', sessionId: 's1', number: 3 }))
    expect(titleOf('s1', 't2')).toBe('Side 3')
  })
})

describe('sweepOrphanedSideChatMeta（孤键清扫）', () => {
  it('清掉 runId 不匹配的残留记录，保留本 run 的', async () => {
    const { sweepOrphanedSideChatMeta, SIDENOTE_RUN_ID } = await import('../src/client/sidechat/metaStore.ts')
    // 上一页面生命周期的残留（runId 不同 + 无 runId 的旧版记录）
    writeSideChatMeta(meta({ tabId: 't1', sessionId: 's1', runId: 'old-run' }))
    localStorage.setItem('dsh-sidenote:side-meta:v1:s1:t2', JSON.stringify(meta({ tabId: 't2', sessionId: 's1' })))
    // 本 run 的活记录
    writeSideChatMeta(meta({ tabId: 't3', sessionId: 's1', runId: SIDENOTE_RUN_ID }))
    expect(sweepOrphanedSideChatMeta()).toBe(2)
    expect(readSideChatMeta('s1', 't1')).toBeUndefined()
    expect(readSideChatMeta('s1', 't2')).toBeUndefined()
    expect(readSideChatMeta('s1', 't3')).toBeDefined()
  })
})
