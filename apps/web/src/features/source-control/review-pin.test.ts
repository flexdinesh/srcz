import assert from "node:assert/strict"
import test from "node:test"

import { pinLimitMs, pinQuietMs, pinSettled, pinWait } from "./review-pin.ts"

test("a pin holds while the pinned diff has not shown", () => {
  const clock = { pinnedAt: 0, changedAt: 0, shows: false }
  assert.equal(pinSettled(pinQuietMs * 2, clock), false)
  assert.equal(pinWait(pinQuietMs * 2, clock), pinLimitMs - pinQuietMs * 2)
})

test("a pin settles once the shown diff and its neighbors keep their size", () => {
  const clock = { pinnedAt: 0, changedAt: 500, shows: true }
  assert.equal(pinSettled(500 + pinQuietMs - 1, clock), false)
  assert.equal(pinWait(500 + pinQuietMs - 1, clock), 1)
  assert.equal(pinSettled(500 + pinQuietMs, clock), true)
  assert.equal(pinWait(500 + pinQuietMs, clock), 0)
})

test("content that keeps changing size holds a pin only up to the limit", () => {
  const clock = { pinnedAt: 0, changedAt: pinLimitMs - 10, shows: true }
  assert.equal(pinSettled(pinLimitMs - 1, clock), false)
  assert.equal(pinWait(pinLimitMs - 1, clock), 1)
  assert.equal(pinSettled(pinLimitMs, clock), true)
  assert.equal(pinSettled(pinLimitMs, { ...clock, shows: false }), true)
})
