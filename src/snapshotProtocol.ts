/** Durable first-send marker, shared by the host projection and client reader. */
export const decodeSnapshotXml = (value: string): string => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

export function snapshotImages(text: string): readonly unknown[] {
  return [...text.matchAll(/<user-request images="([^"]*)">/g)].flatMap(match => {
    try { const value: unknown = JSON.parse(decodeSnapshotXml(match[1]!)); return Array.isArray(value) ? value : [] } catch { return [] }
  })
}

export function imageId(value: unknown): string | undefined {
  const id = (value as { attachmentId?: unknown } | null)?.attachmentId
  return typeof id === 'string' ? id : undefined
}

export interface ImageBlock { type?: string; attachment?: unknown }

/** The native admission may normalize bytes again; persisted refs win over source ids. */
export function admittedSnapshotImages(snapshot: string, blocks: readonly ImageBlock[]): Map<string | undefined, unknown> {
  const ids = [...new Set(snapshotImages(snapshot).map(imageId))]
  if (ids.length === 0) return new Map()
  const images = blocks.filter(block => block.type === 'image').map(block => block.attachment)
  if (images.length < ids.length) return new Map()
  return new Map(ids.map((id, index) => [id, images[images.length - ids.length + index]]))
}

/** Carried images are appended after the user's own attachments by native submit. */
export function withoutSnapshotImages<T extends ImageBlock>(blocks: readonly T[], snapshot: string): T[] {
  let remaining = admittedSnapshotImages(snapshot, blocks).size
  return [...blocks].reverse().filter(block => {
    if (block.type !== 'image' || remaining === 0) return true
    remaining -= 1
    return false
  }).reverse()
}

export function splitSnapshotPrefix(text: string): { snapshot: string; takenAt: string | null; boundarySeq?: number; rest: string } | null {
  if (!text.startsWith('<mainline-progress-snapshot')) return null
  const closeMark = '</mainline-progress-snapshot>'
  const close = text.indexOf(closeMark)
  if (close < 0) return null
  const block = text.slice(0, close + closeMark.length)
  const takenAt = /taken-at="([^"]*)"/.exec(block)?.[1] ?? null
  const boundary = /\bboundary-seq="(-?\d+)"/.exec(block.split('>')[0]!)?.[1]
  return { snapshot: block, takenAt, ...(boundary === undefined ? {} : { boundarySeq: Number(boundary) }), rest: text.slice(close + closeMark.length).trimStart() }
}
