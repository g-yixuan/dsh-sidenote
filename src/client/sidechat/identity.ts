/**
 * 侧边聊天的内容身份（Delivery_05）：编号（「侧边 2」）是存活序——回答
 * 「现在打开着的是哪个」，聊天一关闭就失去指称；native 单实例下编号恒为
 * 1，身份随之整体塌方（关闭列表五行全叫「侧边」的实证）。
 *
 * 身份 = 首条用户消息摘要（topic），sticky——侧边聊天是单主题支线，
 * 首条消息即意图；只认首条，不随对话漂移。本模块是唯一计算源：
 * 芯片标题、通知、@引用、菜单聚焦/重开行、关闭列表全部从这里取。
 *
 * L0 纯函数，react-free。
 */
import { t } from '../locales.ts'

/** 标题里 topic 段的最大码点数（CJK 安全截断）。 */
const TOPIC_MAX = 20

/**
 * 首条用户消息 → topic。折叠全部空白（含换行）为单空格，截 20 码点，
 * 超长加省略号；清洗后为空返回 undefined（调用方回退编号标题）。
 * 快照前缀（Delivery_04）在 composer 层就不进 body，这里无需剥离。
 * 划选提问的种子草稿是「> 引用行 + note 行」（buildSideChatQuote）：
 * 引用行剥除（用户自己的话才是主题），机械占位行（noNote）丢弃；
 * 剥完为空（未补充直接发送）时退回引用内容——引用即主题。
 */
export function topicOf(text: string): string | undefined {
  const lines = text.split('\n')
  const own = lines
    .filter(l => !l.startsWith('>'))
    .filter(l => l.trim() !== t('noNote'))
    .join(' ')
  const clean = own.replaceAll(/\s+/gu, ' ').trim()
  if (clean !== '') return truncate(clean)
  const quoted = lines.filter(l => l.startsWith('>')).map(l => l.replace(/^> ?/u, '')).join(' ')
  return truncate(quoted)
}

/** 空白折叠 + 20 码点截断；空 → undefined。 */
function truncate(text: string): string | undefined {
  const clean = text.replaceAll(/\s+/gu, ' ').trim()
  if (clean === '') return undefined
  const chars = Array.from(clean)
  return chars.length <= TOPIC_MAX ? clean : `${chars.slice(0, TOPIC_MAX).join('')}…`
}

/** 标题计算的最小入参：编号 + 可选 topic（两种 meta 形状都满足）。 */
export interface SideChatIdentity {
  readonly number: number
  readonly topic?: string
}

/**
 * 侧边聊天标题：topic 优先（「侧边 · {topic}」），缺席回退编号
 * （「侧边」/「侧边 N」——单实例期恒前者）。
 */
export function sideChatTitleOf(meta: SideChatIdentity | undefined): string {
  if (meta?.topic !== undefined && meta.topic !== '') return `${t('tabBaseTitle')} · ${meta.topic}`
  if (meta === undefined || meta.number <= 1) return t('tabBaseTitle')
  return `${t('tabBaseTitle')} ${meta.number}`
}

/**
 * 关闭时刻的相对时间（重开行 detail）：刚刚 / N 分钟前 / N 小时前 /
 * 昨天 / M月d日（跨年带年）。小时档只用于当天（日历日）；跨过午夜即落
 * 「昨天」——日历语义比「15 小时前」更好认。手写五档，不引依赖。
 */
export function formatClosedAt(closedAt: number, now: number = Date.now()): string {
  const diff = now - closedAt
  if (diff < 60_000) return t('closedJustNow')
  if (diff < 3_600_000) return t('closedMinutesAgo', { n: Math.floor(diff / 60_000) })
  const then = new Date(closedAt)
  const today = new Date(now)
  const sameDay = then.getFullYear() === today.getFullYear()
    && then.getMonth() === today.getMonth()
    && then.getDate() === today.getDate()
  if (sameDay) return t('closedHoursAgo', { n: Math.floor(diff / 3_600_000) })
  // 「昨天」按日历运算（new Date 的日期自归一），不做毫秒减法——DST 拨快日
  // 只有 23 小时，now-86400_000 会把昨天中午误判成前天（审查 L1 实证）。
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (then.getFullYear() === yesterday.getFullYear()
    && then.getMonth() === yesterday.getMonth()
    && then.getDate() === yesterday.getDate()) return t('closedYesterday')
  if (then.getFullYear() === today.getFullYear()) {
    return t('closedOnDate', { month: then.getMonth() + 1, day: then.getDate() })
  }
  return t('closedOnDateYear', { year: then.getFullYear(), month: then.getMonth() + 1, day: then.getDate() })
}
