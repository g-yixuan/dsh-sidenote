/**
 * R8 侧边审批/提问答复（L0/L1：双版本数据源探测链 + 视图模型归一）。
 *
 * 侦察依据（.vibe Delivery_04/Workitem_02 design.md）：
 * - pending 不在 projections.faceOf 体系——0.1.1 在 Session 快照顶层
 *   `pending: PendingWait[]`（mux 帧铸造，重连重放 rpcId 不变）；0.1.2 移入
 *   `ctx.get('uiSession').pendingInteractions`（Map<SessionId, Pending>，
 *   每会话至多一项，precedence 仲裁）。
 * - 写路径都是公开对象的公开方法：0.1.1 `wait.respond({ok,value})`（审批
 *   value={sessionId, approvalId, outcome}；提问整批 {sessionId, answer}，
 *   取消走 {ok:false,error:{code:'cancelled',…}}）；0.1.2 域对象
 *   `answer(outcome|answer)` / `cancel()`。
 * - 竞答安全：先答先得，settle 幂等——后答方 throw，UI catch 吞掉并回退
 *   按钮态（宿主同款 `.catch(() => setAnswered(false))`）。
 *
 * off-face 纪律：两面都 feature-check；全缺席返回 undefined（面板回退
 * pendingBar 跳转行为，不崩）。
 */

// ── 视图模型（视图层唯一消费形状；双版本在此归一）──

export interface PendingApprovalView {
  kind: 'approval'
  key: string
  toolName: string
  reason?: string | undefined
  answer: (outcome: 'allowed-once' | 'rejected') => Promise<void>
}

export interface PendingQuestionOption {
  label: string
  description?: string | undefined
}

export interface PendingQuestionView {
  kind: 'question'
  key: string
  /** plan-review 按通用提问流降级（提交值逐字回传 asker 原 label）。 */
  planReview: boolean
  questions: readonly {
    id: string
    question: string
    header?: string | undefined
    detail?: string | undefined
    options: readonly PendingQuestionOption[]
    multiSelect: boolean
  }[]
  /** 整批提交（不可拆单题）：answers = [{id, selected: label[], custom?}]。 */
  answer: (answers: readonly { id: string; selected: readonly string[]; custom?: string }[]) => Promise<void>
  cancel: () => Promise<void>
}

export type PendingItem = PendingApprovalView | PendingQuestionView

export interface PendingStore {
  readonly available: boolean
  subscribe(fn: () => void): () => void
  /** 缓存快照：底层引用不变则返回同一数组（uSES 纪律）。 */
  getSnapshot(): readonly PendingItem[]
}

interface CtxLike {
  get?: (key: string) => unknown
}

interface SessionLike {
  subscribe(fn: () => void): () => void
  getSnapshot(): unknown
}

// ── 0.1.2 适配（uiSession.pendingInteractions 域对象）──

function adapt012(pending: unknown): readonly PendingItem[] {
  if (typeof pending !== 'object' || pending === null) return []
  const o = pending as Record<string, unknown>
  if (o.kind === 'approval' && typeof o.answer === 'function') {
    return [{
      kind: 'approval',
      key: typeof o.key === 'string' ? o.key : 'approval',
      toolName: typeof o.toolName === 'string' ? o.toolName : '',
      ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
      answer: (outcome) => (o.answer as (x: string) => Promise<void>).call(o, outcome),
    }]
  }
  if ((o.kind === 'question' || o.kind === 'plan-review') && typeof o.answer === 'function' && typeof o.cancel === 'function') {
    const questions = normalizeQuestions(o.questions ?? (o.payload as { questions?: unknown } | undefined)?.questions)
    if (questions === undefined) return []
    return [{
      kind: 'question',
      key: typeof o.key === 'string' ? o.key : 'question',
      planReview: o.kind === 'plan-review',
      questions,
      answer: (answers) => (o.answer as (a: unknown) => Promise<void>).call(o, { answers }),
      cancel: () => (o.cancel as () => Promise<void>).call(o),
    }]
  }
  return []
}

// ── 0.1.1 适配（Session 快照 pending: PendingWait[]）──

interface PendingWaitLike {
  kind?: unknown
  key?: unknown
  sessionId?: unknown
  payload?: unknown
  respond?: unknown
}

function adapt011(pending: readonly unknown[]): readonly PendingItem[] {
  const items: PendingItem[] = []
  for (const raw of pending) {
    const w = raw as PendingWaitLike
    if (typeof w.respond !== 'function') continue
    const respond = w.respond as (r: unknown) => Promise<{ accepted?: boolean }>
    const sessionId = typeof w.sessionId === 'string' ? w.sessionId : undefined
    if (sessionId === undefined) continue
    const payload = (w.payload ?? {}) as Record<string, unknown>
    const key = typeof w.key === 'string' ? w.key : `pending:${items.length}`
    if (w.kind === 'approval') {
      const approvalId = payload.approvalId
      if (typeof approvalId !== 'string') continue
      items.push({
        kind: 'approval',
        key,
        toolName: typeof payload.toolName === 'string' ? payload.toolName : '',
        ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
        answer: async (outcome) => {
          const receipt = await respond({ ok: true, value: { sessionId, approvalId, outcome } })
          if (receipt.accepted === false) throw new Error('approval response rejected (not pending)')
        },
      })
    } else if (w.kind === 'question') {
      const questions = normalizeQuestions(payload.questions)
      if (questions === undefined) continue
      items.push({
        kind: 'question',
        key,
        planReview: false,
        questions,
        answer: async (answers) => {
          const receipt = await respond({ ok: true, value: { sessionId, answer: { answers } } })
          if (receipt.accepted === false) throw new Error('question response rejected (not pending)')
        },
        cancel: async () => {
          await respond({ ok: false, error: { code: 'cancelled', message: 'the user closed this question request', details: {} } })
        },
      })
    }
  }
  return items
}

/** questions 字段归一（选项 {label,description?} 与纯字符串两形都收）。 */
function normalizeQuestions(raw: unknown): PendingQuestionView['questions'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: PendingQuestionView['questions'][number][] = []
  for (const rawQ of raw) {
    if (typeof rawQ !== 'object' || rawQ === null) return undefined
    const q = rawQ as Record<string, unknown>
    if (typeof q.question !== 'string') return undefined
    const options: PendingQuestionOption[] = []
    if (Array.isArray(q.options)) {
      for (const rawO of q.options) {
        if (typeof rawO === 'string') options.push({ label: rawO })
        else if (typeof rawO === 'object' && rawO !== null && typeof (rawO as { label?: unknown }).label === 'string') {
          const oo = rawO as { label: string; description?: unknown }
          options.push({ label: oo.label, ...(typeof oo.description === 'string' ? { description: oo.description } : {}) })
        } else return undefined
      }
    }
    out.push({
      id: typeof q.id === 'string' ? q.id : `q${out.length}`,
      question: q.question,
      ...(typeof q.header === 'string' ? { header: q.header } : {}),
      ...(typeof q.detail === 'string' ? { detail: q.detail } : {}),
      options,
      multiSelect: q.multiSelect === true,
    })
  }
  return out
}

/**
 * 双版本探测链（chatSourceOf 同款纪律）：0.1.2 uiSession.pendingInteractions
 * （getSnapshot() 是 Map 才认）优先；0.1.1 Session 快照 pending 数组回退；
 * 双缺席 undefined（面板回退 pendingBar 跳转）。
 */
export function createPendingStore(ctx: CtxLike, session: SessionLike | undefined, childId: string): PendingStore | undefined {
  // 面 1（0.1.2+）：uiSession 服务的 pendingInteractions observable。
  try {
    const ui = typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined
    const pim = (ui as { pendingInteractions?: { subscribe?: unknown; getSnapshot?: unknown } } | undefined)?.pendingInteractions
    if (pim !== undefined && typeof pim.subscribe === 'function' && typeof pim.getSnapshot === 'function') {
      const obs = pim as { subscribe(fn: () => void): () => void; getSnapshot(): unknown }
      if (obs.getSnapshot() instanceof Map) {
        let cachedMap: unknown = null
        let cachedItems: readonly PendingItem[] = []
        return {
          available: true,
          subscribe: (fn) => obs.subscribe(fn),
          getSnapshot: () => {
            const map = obs.getSnapshot()
            if (map === cachedMap) return cachedItems
            cachedMap = map
            cachedItems = map instanceof Map ? adapt012(map.get(childId)) : []
            return cachedItems
          },
        }
      }
    }
  } catch {
    // 落面 2。
  }
  // 面 2（0.1.1）：Session 快照顶层 pending 数组。
  if (session === undefined) return undefined
  try {
    const snap = session.getSnapshot()
    if (Array.isArray((snap as { pending?: unknown } | null)?.pending)) {
      let cachedArr: unknown = null
      let cachedItems: readonly PendingItem[] = []
      return {
        available: true,
        subscribe: (fn) => session.subscribe(fn),
        getSnapshot: () => {
          const arr = (session.getSnapshot() as { pending?: unknown } | null)?.pending
          if (arr === cachedArr) return cachedItems
          cachedArr = arr
          cachedItems = Array.isArray(arr) ? adapt011(arr) : []
          return cachedItems
        },
      }
    }
  } catch {
    // 双缺席。
  }
  return undefined
}
