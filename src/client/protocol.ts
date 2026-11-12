/** Shared XML codec. Decode exactly once so literal entities survive a round trip. */
export function xmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function xmlAttr(value: string): string {
  return xmlText(value).replaceAll('"', '&quot;')
}

export function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]!)
}

/** Reflows and native @ references share the same full-text question/answer fields. */
export function formatQuestionAnswer(question: string | undefined, answer: string): string {
  const prefix = question?.trim() ? `<question>${xmlText(question)}</question>\n` : ''
  return `${prefix}<answer>${xmlText(answer)}</answer>`
}
