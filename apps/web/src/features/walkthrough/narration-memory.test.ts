import assert from "node:assert/strict"
import test from "node:test"

import { narrationCollapsed, parseNarrationCollapsed } from "./narration-memory.ts"

test("only a stored boolean counts as the reader's choice", () => {
  assert.equal(parseNarrationCollapsed({ collapsed: true }), true)
  assert.equal(parseNarrationCollapsed({ collapsed: false }), false)
  assert.equal(parseNarrationCollapsed({ collapsed: "yes" }), null)
  assert.equal(parseNarrationCollapsed(null), null)
  assert.equal(parseNarrationCollapsed([true]), null)
})

test("phones start collapsed until the reader chooses", () => {
  assert.equal(narrationCollapsed(null, true), true)
  assert.equal(narrationCollapsed(null, false), false)
  assert.equal(narrationCollapsed(false, true), false)
  assert.equal(narrationCollapsed(true, false), true)
})
