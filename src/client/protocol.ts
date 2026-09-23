/**
 * 模型-facing 协议块的 XML 属性位转义（L0 共享层）。
 *
 * 何时需要：把用户可推导的字符串（如侧边聊天的 topic 化标题，Delivery_05
 * 起标题来自首条消息）拼进 `<tag attribute="...">` 的属性位前必须转义，
 * 否则引号撑破属性、尖括号污染块结构。内容位（<问>/<答> 之间）保持原文，
 * 不转义——模型读取友好且不改写用户数据。
 */
export function xmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
