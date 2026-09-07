/**
 * 气泡留痕手术（Delivery_02 Workitem_01/v3）：携带协议前缀（回流 XML 块 +
 * 注释 XML 块）发出的用户消息，在消息流里把协议前缀隐藏、替换为留痕标签
 * （「批注 ×N」/「含侧边回流上下文」）——模型看到完整上下文，用户界面
 * 保持干净，发送后有据可回。
 *
 * 关键事实（侦察所得）：宿主 user 气泡是**纯文本渲染**（UserStyleBubble /
 * projectUserText，无 markdown 元素），所以手术按**字符区间**切文本节点，
 * 而不是找 <p>/<ol>/<blockquote>。协议区由 send.ts 保证是消息连续前缀；
 * splitProtocolPrefix（format.ts）是纯函数、双语容错、单测覆盖。
 *
 * 幂等：注入的标签带 data-dsh-sidenote-bubble 标记；宿主重渲染丢失后下次
 * 扫描重挂。观察者纪律与 overlay 同款（100ms 尾沿去抖）。
 */
import { flattenReflowContent, splitProtocolPrefix } from './format.ts'
import { t } from '../locales.ts'
import css from './annotate.module.css'

/** 把 root 内前 length 个字符的文本节点包进一个隐藏 span；字符不足返回 null。 */
function hidePrefixChars(root: HTMLElement, length: number): HTMLSpanElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = length
  const nodes: Text[] = []
  let node = walker.nextNode() as Text | null
  while (node !== null && remaining > 0) {
    nodes.push(node)
    remaining -= node.data.length
    node = walker.nextNode() as Text | null
  }
  // 字符数对不上（宿主渲染差异）→ 放弃手术，宁可原文显示也不留半残。
  if (nodes.length === 0 || remaining > 0) return null
  const last = nodes[nodes.length - 1]!
  if (remaining < 0) last.splitText(last.data.length + remaining)
  const span = document.createElement('span')
  span.style.display = 'none'
  span.dataset.dshSidenote = ''
  const first = nodes[0]!
  first.parentNode?.insertBefore(span, first)
  for (const tn of nodes) span.appendChild(tn)
  return span
}

/** 处理一个 user 流项；已处理/未命中都幂等。 */
function applySurgery(flowItem: HTMLElement): void {
  if (flowItem.querySelector(':scope [data-dsh-sidenote-bubble]') !== null) return
  const text = flowItem.textContent ?? ''
  const proto = splitProtocolPrefix(text)
  if (proto === null) return
  const hidden = hidePrefixChars(flowItem, proto.length)
  if (hidden === null) return

  const labels = document.createElement('span')
  labels.dataset.dshSidenote = ''
  labels.dataset.dshSidenoteBubble = ''
  labels.className = css.sentChipRow ?? ''
  if (proto.annotations.length > 0) {
    const chip = document.createElement('span')
    chip.className = css.sentChip ?? ''
    chip.textContent = t('sentChipLabel', { n: proto.annotations.length })
    chip.title = proto.annotations
      .map(a => `${a.id}. 「${a.quote.length > 200 ? `${a.quote.slice(0, 200)}…` : a.quote}」${a.note === '' ? t('noNote') : a.note}`)
      .join('\n')
    labels.appendChild(chip)
  }
  if (proto.reflows.length > 0) {
    const chip = document.createElement('span')
    chip.className = css.sentChip ?? ''
    chip.textContent = t('reflowBubbleLabel')
    chip.title = proto.reflows.map(r => `${r.source}: ${flattenReflowContent(r.content).slice(0, 200)}`).join('\n')
    labels.appendChild(chip)
  }
  hidden.insertAdjacentElement('afterend', labels)
}

/** 全量扫描（去抖后调用）；只处理尚未手术的 user/steering 流项
 *  （steer 发出的消息同用 UserStyleBubble 渲染，kind 不同——C2 审查发现）。 */
function scan(): void {
  const items = document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
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
