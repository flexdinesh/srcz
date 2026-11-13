import { useEffect } from "react"

import { intersect, overflows, scrollForDrag, scrollForPage, thumbFor, type Box, type ScrollMetrics } from "../../lib/scrollbar-geometry.ts"

// Overlay scrollbars (decision 0140): native bars are hidden for fine
// pointers, and one fixed layer draws a thumb over the edge of the scroll
// area under the pointer or being scrolled. It takes no layout space, shows
// while the area scrolls or the pointer is over it, and fades when idle.
// Touch keeps the platform's own overlay bars.

// scrollbarPressEvent is dispatched on a scroller when its overlay scrollbar
// is pressed, the way a press on a native bar targets the scroller itself.
export const scrollbarPressEvent = "zero-scrollbar-press"

const finePointer = "(pointer: fine)"
// idleDelay is how long a thumb stays after its area last scrolled, as in
// VS Code; the fade then runs in CSS.
const idleDelay = 800

type Axis = "y" | "x"

interface Bar {
  axis: Axis
  track: HTMLDivElement
  thumb: HTMLDivElement
  target: Element | null
  // clippers are the target's ancestors that clip it, nearest first.
  clippers: Element[]
  hovered: boolean
  overTrack: boolean
  scrolledAt: number
  drag: { pointer: number; start: number } | null
  // lane is where the track was last drawn, in viewport pixels.
  lane: Box | null
  length: number
}

function parentOf(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

function metrics(element: Element, axis: Axis): ScrollMetrics {
  return axis === "y"
    ? { client: element.clientHeight, content: element.scrollHeight, scroll: element.scrollTop }
    : { client: element.clientWidth, content: element.scrollWidth, scroll: element.scrollLeft }
}

// scrollsOn is whether an element is a scroll area with overflow on axis.
function scrollsOn(element: Element, axis: Axis): boolean {
  if (element === document.documentElement || element === document.body) return false
  if (element instanceof HTMLElement && element.dataset.scrollbar === "none") return false
  if (!overflows(metrics(element, axis))) return false
  const style = getComputedStyle(element)
  const overflow = axis === "y" ? style.overflowY : style.overflowX
  if (overflow !== "auto" && overflow !== "scroll") return false
  // An area that keeps its native bar (Pierre's wide diff code) gets no
  // second one. An engine without scrollbar-width reports nothing.
  const width = style.getPropertyValue("scrollbar-width")
  return width === "" || width === "none"
}

function clippersOf(element: Element): Element[] {
  const clippers: Element[] = []
  for (let node = parentOf(element); node; node = parentOf(node)) {
    if (node === document.documentElement || node === document.body) continue
    const style = getComputedStyle(node)
    if (style.overflowX !== "visible" || style.overflowY !== "visible") clippers.push(node)
  }
  return clippers
}

function box(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

function setScroll(element: Element, axis: Axis, value: number) {
  if (axis === "y") element.scrollTop = value
  else element.scrollLeft = value
}

function createBar(layer: HTMLElement, axis: Axis): Bar {
  const track = document.createElement("div")
  track.className = "ui-scrollbar"
  track.dataset.axis = axis
  const thumb = document.createElement("div")
  thumb.className = "ui-scrollbar-thumb"
  track.append(thumb)
  layer.append(track)
  return { axis, track, thumb, target: null, clippers: [], hovered: false, overTrack: false, scrolledAt: 0, drag: null, lane: null, length: 0 }
}

// mountOverlayScrollbars starts the layer and returns its cleanup.
function mountOverlayScrollbars(): () => void {
  const layer = document.createElement("div")
  layer.className = "ui-scrollbars"
  layer.setAttribute("aria-hidden", "true")
  document.body.append(layer)
  const bars = [createBar(layer, "y"), createBar(layer, "x")]
  const resize = new ResizeObserver(() => schedule())
  let frame = 0
  let idleTimer = 0

  const observe = () => {
    resize.disconnect()
    for (const bar of bars) {
      if (!bar.target) continue
      resize.observe(bar.target)
      for (const child of bar.target.children) resize.observe(child)
    }
  }

  // A scroll area inside a modal dialog is above everything else and the
  // rest of the page is inert, so the layer moves into the dialog.
  const placeLayer = () => {
    let host: Element = document.body
    for (const bar of bars) {
      for (let node = bar.target; node; node = parentOf(node)) {
        if (node instanceof HTMLDialogElement && node.open) {
          host = node
          break
        }
      }
    }
    if (layer.parentElement !== host) host.append(layer)
  }

  const onTargetScroll = (event: Event) => {
    for (const bar of bars) if (event.target === bar.target) bar.scrolledAt = performance.now()
    scrolled()
  }

  const setTarget = (bar: Bar, target: Element | null) => {
    if (bar.target === target || bar.drag) return
    // Shadow roots keep their scroll events, so each target gets its own
    // listener beside the document's.
    if (bar.target && !bars.some((other) => other !== bar && other.target === bar.target)) {
      bar.target.removeEventListener("scroll", onTargetScroll)
    }
    bar.target = target
    bar.clippers = target ? clippersOf(target) : []
    target?.addEventListener("scroll", onTargetScroll, { passive: true })
    observe()
  }

  const scrolled = () => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(schedule, idleDelay)
    schedule()
  }

  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update)
  }

  // update reads every box first, then writes, so a frame lays out once.
  const update = () => {
    frame = 0
    // A dialog that closes or unmounts takes the layer with it.
    placeLayer()
    const now = performance.now()
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    const plans = bars.map((bar) => {
      const target = bar.target
      if (!target || !target.isConnected) return null
      const current = metrics(target, bar.axis)
      const shown = bar.drag !== null || bar.hovered || bar.overTrack || now - bar.scrolledAt < idleDelay
      if (!shown || !overflows(current)) return null
      const size = bar.axis === "y" ? bar.track.offsetWidth : bar.track.offsetHeight
      const rect = target.getBoundingClientRect()
      const left = rect.left + target.clientLeft
      const top = rect.top + target.clientTop
      const right = left + target.clientWidth
      const bottom = top + target.clientHeight
      // Both bars on one area leave each other the corner.
      const other = bars.find((candidate) => candidate !== bar)
      const corner = other?.target === target && overflows(metrics(target, other.axis)) ? size : 0
      const length = Math.max(0, (bar.axis === "y" ? bottom - top : right - left) - corner)
      // region is the part of the area in view; a lane keeps to its edge, so
      // a tall diff's horizontal bar rides the bottom of the pane.
      let region: Box | null = intersect({ left, top, right, bottom }, viewport)
      for (const clipper of bar.clippers) {
        if (!region) break
        const clip = clipper.getBoundingClientRect()
        region = intersect(region, { left: clip.left + clipper.clientLeft, top: clip.top + clipper.clientTop,
          right: clip.left + clipper.clientLeft + clipper.clientWidth, bottom: clip.top + clipper.clientTop + clipper.clientHeight })
      }
      if (!region) return null
      const lane = bar.axis === "y"
        ? { left: region.right - size, top, right: region.right, bottom: top + length }
        : { left, top: region.bottom - size, right: left + length, bottom: region.bottom }
      const visible = intersect(lane, region)
      if (!visible) return null
      return { bar, lane, visible, length, thumb: thumbFor(current, length) }
    })
    for (const [index, bar] of bars.entries()) {
      const plan = plans[index]
      if (!plan) {
        delete bar.track.dataset.visible
        bar.lane = null
        continue
      }
      const { lane, visible, length, thumb } = plan
      bar.lane = lane
      bar.length = length
      const { track } = bar
      track.dataset.visible = ""
      track.style.transform = `translate(${lane.left}px, ${lane.top}px)`
      if (bar.axis === "y") track.style.height = `${length}px`
      else track.style.width = `${length}px`
      track.style.clipPath = `inset(${visible.top - lane.top}px ${lane.right - visible.right}px ${lane.bottom - visible.bottom}px ${visible.left - lane.left}px)`
      bar.thumb.style.transform = bar.axis === "y" ? `translateY(${thumb.offset}px)` : `translateX(${thumb.offset}px)`
      if (bar.axis === "y") bar.thumb.style.height = `${thumb.length}px`
      else bar.thumb.style.width = `${thumb.length}px`
    }
  }

  // nearest finds the closest scroll area on each axis along an event's
  // path, through shadow roots; null when the path is the layer's own.
  const nearest = (event: Event): Record<Axis, Element | null> | null => {
    const found: Record<Axis, Element | null> = { y: null, x: null }
    for (const node of event.composedPath()) {
      if (node === layer) return null
      if (!(node instanceof Element)) continue
      if (!found.y && scrollsOn(node, "y")) found.y = node
      if (!found.x && scrollsOn(node, "x")) found.x = node
      if (found.y && found.x) break
    }
    return found
  }

  const hover = (event: Event) => {
    const found = nearest(event)
    if (!found) return
    for (const bar of bars) {
      const target = found[bar.axis]
      bar.hovered = target !== null
      if (target) setTarget(bar, target)
    }
    schedule()
  }

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== "touch") hover(event)
  }

  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget !== null) return
    for (const bar of bars) bar.hovered = false
    schedule()
  }

  // Any scroll shows its area's thumb, unless the pointer rests on another.
  const onScroll = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    for (const bar of bars) {
      if (bar.target === target) bar.scrolledAt = performance.now()
      else if ((!bar.hovered || !bar.target) && scrollsOn(target, bar.axis)) {
        setTarget(bar, target)
        bar.scrolledAt = performance.now()
      }
    }
    scrolled()
  }

  const along = (bar: Bar, event: PointerEvent) => bar.axis === "y" ? event.clientY : event.clientX

  for (const bar of bars) {
    const { track } = bar
    track.addEventListener("pointerenter", () => {
      bar.overTrack = true
      track.dataset.active = ""
      schedule()
    })
    track.addEventListener("pointerleave", () => {
      bar.overTrack = false
      if (!bar.drag) delete track.dataset.active
      schedule()
    })
    track.addEventListener("pointerdown", (event) => {
      const target = bar.target
      if (event.button !== 0 || !target || !bar.lane) return
      event.preventDefault()
      target.dispatchEvent(new CustomEvent(scrollbarPressEvent))
      const current = metrics(target, bar.axis)
      const point = along(bar, event) - (bar.axis === "y" ? bar.lane.top : bar.lane.left)
      const thumb = thumbFor(current, bar.length)
      if (point < thumb.offset || point > thumb.offset + thumb.length) {
        setScroll(target, bar.axis, scrollForPage(current, bar.length, point))
        return
      }
      bar.drag = { pointer: along(bar, event), start: current.scroll }
      track.dataset.dragging = ""
      track.setPointerCapture(event.pointerId)
    })
    track.addEventListener("pointermove", (event) => {
      const target = bar.target
      if (!bar.drag || !target) return
      const next = scrollForDrag(metrics(target, bar.axis), bar.length, bar.drag.start, along(bar, event) - bar.drag.pointer)
      setScroll(target, bar.axis, next)
    })
    const endDrag = () => {
      if (!bar.drag) return
      bar.drag = null
      delete track.dataset.dragging
      if (!bar.overTrack) delete track.dataset.active
      scrolled()
    }
    track.addEventListener("pointerup", endDrag)
    track.addEventListener("pointercancel", endDrag)
    track.addEventListener("lostpointercapture", endDrag)
  }

  const listen = { capture: true, passive: true }
  document.addEventListener("pointerover", onPointerOver, listen)
  document.addEventListener("pointerout", onPointerOut, listen)
  document.addEventListener("wheel", hover, listen)
  document.addEventListener("scroll", onScroll, listen)
  window.addEventListener("resize", schedule)

  return () => {
    document.removeEventListener("pointerover", onPointerOver, listen)
    document.removeEventListener("pointerout", onPointerOut, listen)
    document.removeEventListener("wheel", hover, listen)
    document.removeEventListener("scroll", onScroll, listen)
    window.removeEventListener("resize", schedule)
    for (const bar of bars) bar.target?.removeEventListener("scroll", onTargetScroll)
    resize.disconnect()
    window.cancelAnimationFrame(frame)
    window.clearTimeout(idleTimer)
    layer.remove()
  }
}

// OverlayScrollbars mounts the layer while the primary pointer is fine.
export function OverlayScrollbars() {
  useEffect(() => {
    const query = window.matchMedia(finePointer)
    let unmount: (() => void) | null = null
    const sync = () => {
      if (query.matches && !unmount) unmount = mountOverlayScrollbars()
      else if (!query.matches && unmount) {
        unmount()
        unmount = null
      }
    }
    sync()
    query.addEventListener("change", sync)
    return () => {
      query.removeEventListener("change", sync)
      unmount?.()
    }
  }, [])
  return null
}
