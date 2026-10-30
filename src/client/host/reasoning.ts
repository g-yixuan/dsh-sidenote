/** Match rc.5's display preparation without changing persisted model output.
 * Older hosts expose only the raw block; the context reader uses this same
 * preparation on every supported host, including incomplete streaming tags. */
export function reasoningDisplayText(raw: string): string {
  if (!raw.startsWith('<')) return raw
  const opening = '<signature>'
  if (opening.startsWith(raw)) return ''
  if (!raw.startsWith(opening)) return raw
  const closing = '</signature>'
  const end = raw.indexOf(closing, opening.length)
  return end < 0 ? '' : raw.slice(end + closing.length).replace(/^(?:\r?\n)*/, '')
}
