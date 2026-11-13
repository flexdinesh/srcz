// Overlay scrollbar geometry along one axis (decision 0140). Every length is
// in CSS pixels; scroll is the scroller's scrollTop or scrollLeft.

// minThumb keeps a long document's thumb big enough to grab.
export const minThumb = 20

export interface ScrollMetrics {
  // client is the visible length, content the scrollable length.
  client: number
  content: number
  scroll: number
}

export interface Thumb {
  // offset is the thumb's start within the track.
  offset: number
  length: number
}

// overflows is whether there is anything to scroll.
export function overflows({ client, content }: ScrollMetrics): boolean {
  return content - client >= 1
}

// thumbFor places the thumb in a track of the given length: its length is
// the visible share of the content, its offset the scrolled share of the rest.
export function thumbFor(metrics: ScrollMetrics, track: number): Thumb {
  const { client, content, scroll } = metrics
  const range = content - client
  if (range < 1 || track <= 0 || content <= 0) return { offset: 0, length: track }
  const length = Math.min(track, Math.max(minThumb, (track * client) / content))
  const progress = Math.min(1, Math.max(0, scroll / range))
  return { offset: (track - length) * progress, length }
}

// scrollForDrag is the scroll position after dragging the thumb by delta
// pixels from a press made at scroll start.
export function scrollForDrag(metrics: ScrollMetrics, track: number, start: number, delta: number): number {
  const { client, content } = metrics
  const range = content - client
  const free = track - thumbFor(metrics, track).length
  if (range < 1 || free <= 0) return start
  return Math.min(range, Math.max(0, start + (delta * range) / free))
}

// scrollForPage is the scroll position after a press on the track at point
// (within the track): one page toward it, as a native track press does.
export function scrollForPage(metrics: ScrollMetrics, track: number, point: number): number {
  const { client, content, scroll } = metrics
  const range = content - client
  const thumb = thumbFor(metrics, track)
  if (range < 1) return scroll
  if (point < thumb.offset) return Math.max(0, scroll - client)
  if (point > thumb.offset + thumb.length) return Math.min(range, scroll + client)
  return scroll
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

// intersect is the part of a inside b, or null when they do not overlap.
export function intersect(a: Box, b: Box): Box | null {
  const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
  return box.right > box.left && box.bottom > box.top ? box : null
}
