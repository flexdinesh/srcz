import assert from "node:assert/strict"
import test from "node:test"

import { intersect, minThumb, overflows, scrollForDrag, scrollForPage, thumbFor } from "./scrollbar-geometry.ts"

test("a scroller overflows only by a whole pixel or more", () => {
  assert.equal(overflows({ client: 500, content: 500, scroll: 0 }), false)
  assert.equal(overflows({ client: 500, content: 500.5, scroll: 0 }), false)
  assert.equal(overflows({ client: 500, content: 501, scroll: 0 }), true)
})

test("the thumb is the visible share of the content, placed by the scrolled share", () => {
  const metrics = { client: 500, content: 2000, scroll: 0 }
  assert.deepEqual(thumbFor(metrics, 500), { offset: 0, length: 125 })
  assert.deepEqual(thumbFor({ ...metrics, scroll: 750 }, 500), { offset: 187.5, length: 125 })
  assert.deepEqual(thumbFor({ ...metrics, scroll: 1500 }, 500), { offset: 375, length: 125 })
})

test("a long document's thumb keeps a grabbable length", () => {
  const thumb = thumbFor({ client: 500, content: 500_000, scroll: 499_500 }, 500)
  assert.equal(thumb.length, minThumb)
  assert.equal(thumb.offset, 500 - minThumb)
})

test("overscroll clamps the thumb to its track", () => {
  const metrics = { client: 500, content: 2000, scroll: 0 }
  assert.equal(thumbFor({ ...metrics, scroll: -40 }, 500).offset, 0)
  assert.equal(thumbFor({ ...metrics, scroll: 1600 }, 500).offset, 375)
})

test("content that fits fills the track", () => {
  assert.deepEqual(thumbFor({ client: 500, content: 400, scroll: 0 }, 500), { offset: 0, length: 500 })
})

test("dragging the thumb moves the content by the track's ratio, within its range", () => {
  const metrics = { client: 500, content: 2000, scroll: 0 }
  // The thumb moves through 375px while the content moves through 1500px.
  assert.equal(scrollForDrag(metrics, 500, 0, 75), 300)
  assert.equal(scrollForDrag(metrics, 500, 300, -75), 0)
  assert.equal(scrollForDrag(metrics, 500, 0, -10), 0)
  assert.equal(scrollForDrag(metrics, 500, 1400, 200), 1500)
  assert.equal(scrollForDrag({ client: 500, content: 400, scroll: 0 }, 500, 0, 50), 0)
})

test("a press on the track pages toward it; a press on the thumb does not", () => {
  const metrics = { client: 500, content: 2000, scroll: 750 }
  // The thumb spans 187.5 to 312.5.
  assert.equal(scrollForPage(metrics, 500, 400), 1250)
  assert.equal(scrollForPage(metrics, 500, 50), 250)
  assert.equal(scrollForPage(metrics, 500, 250), 750)
  assert.equal(scrollForPage({ ...metrics, scroll: 1400 }, 500, 499), 1500)
  assert.equal(scrollForPage({ ...metrics, scroll: 100 }, 500, 0), 0)
})

test("intersect clips one box to another", () => {
  const pane = { left: 0, top: 100, right: 800, bottom: 900 }
  assert.deepEqual(intersect({ left: 10, top: 50, right: 300, bottom: 400 }, pane), { left: 10, top: 100, right: 300, bottom: 400 })
  assert.equal(intersect({ left: 10, top: 950, right: 300, bottom: 1000 }, pane), null)
})
