/**
 * 气泡留痕手术（Delivery_02 Workitem_01）：携带协议块发出的用户消息，在
 * 消息流里把协议部分隐藏、替换为「批注 ×N」标签（点击展开回看每条引用与
 * 注解）——模型看到了完整上下文，用户界面保持干净，且发送后有据可回。
 *
 * 机制：MutationObserver（100ms 尾沿去抖，与 overlay 同款纪律）扫描
 * [data-chat-flow-kind="user"] 流项；命中「首段 = 协议头 + 紧随 <ol>」的
 * 结构 → 隐藏两段 → 注入标签（data-dsh-sidenote 标记，宿主重渲染丢失后
 * 下次扫描幂等重挂）。反解析只认结构不认内容文本之外的状态，刷新后历史
 * 重渲染时天然重建。
 */
import { PROTOCOL_HEADER_RE, parseProtocolItem, type ParsedProtocolItem } from './format.ts'
import { t } from '../locales.ts'
import css from './annotate.module.css'

/** 处理一个 user 流项；已处理/未命中都幂等。 */
function applySurgery(flowItem: HTMLElement): void {
  if (flowItem.querySelector(':scope [data-dsh-sidenote-sent]') !== null) return
  const paragraphs = flowItem.querySelectorAll('p')
  const header = [...paragraphs].find(p => PROTOCOL_HEADER_RE.test((p.textContent ?? '').trim()))
  if (header === undefined) return
  // 协议条目列表 = 头部段落后最近的 <ol>。
  const list = header.nextElementSibling
  if (!(list instanceof HTMLOListElement)) return
  const items = [...list.querySelectorAll(':scope > li')]
    .map(li => parseProtocolItem(li.textContent ?? ''))
    .filter((item): item is ParsedProtocolItem => item !== null)
  if (items.length === 0) return

  header.style.display = 'none'
  list.style.display = 'none'

  const label = document.createElement('button')
  label.type = 'button'
  label.dataset.dshSidenote = ''
  label.dataset.dshSidenoteSent = ''
  label.className = css.sentChip ?? ''
  label.textContent = t('sentChipLabel', { n: items.length })
  label.title = items.map((item, i) => `${i + 1}. 「${item.quote}」${item.note === '' ? t('noNote') : item.note}`).join('\n')
  list.insertAdjacentElement('afterend', label)
}

/** 全量扫描（去抖后调用）；只处理当前 DOM 里尚未手术的 user 流项。 */
function scan(): void {
  const items = document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"]')
  for (const item of items) {
    try {
      applySurgery(item)
    } catch (error) {
      console.warn('[dsh-sidenote] 气泡留痕手术失败（单项跳过）:', error)
    }
  }
}

/** 安装观察者；返回卸载函数。 */
export function installBubbleSurgery(): () => void {
  let timer = 0
  const debounced = (): void => {
    if (timer !== 0) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = 0
      scan()
    }, 100)
  }
  const observer = new MutationObserver(debounced)
  try {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  } catch {
    // document.body 缺失（极早期）——首轮扫描也跳过即可。
  }
  scan()
  return () => {
    observer.disconnect()
    if (timer !== 0) window.clearTimeout(timer)
  }
}
