import assert from "node:assert/strict"
import test from "node:test"

import { isViewed, parseViewed, viewedState, withViewed } from "./review-viewed.ts"

const blob = "a".repeat(40)
const changed = "b".repeat(40)

test("a viewed mark holds only while the file's blob matches", () => {
  const marks = withViewed({}, "/p", "a.md", blob, true)
  assert.equal(isViewed(marks, "/p", "a.md", blob), true)
  assert.equal(isViewed(marks, "/p", "a.md", changed), false)
  assert.equal(isViewed(marks, "/q", "a.md", blob), false)
  assert.equal(isViewed(marks, "/p", "a.md", ""), false)
  assert.equal(isViewed(withViewed(marks, "/p", "a.md", blob, false), "/p", "a.md", blob), false)
  assert.equal(isViewed(withViewed({}, "/p", "a.md", "", true), "/p", "a.md", ""), false)
})

test("stored marks keep well-formed entries only", () => {
  assert.deepEqual(parseViewed({ "/p": { "a.md": blob, "b.md": "short", "c.md": 3 }, "/q": [], "/r": "x", "/s": {} }), { "/p": { "a.md": blob }, "/s": {} })
  assert.deepEqual(parseViewed(null), {})
})

test("a mark made at an older blob reads as changed since viewed until marked again", () => {
  const marks = withViewed({}, "/p", "a.md", blob, true)
  assert.equal(viewedState(marks, "/p", "a.md", blob), "viewed")
  assert.equal(viewedState(marks, "/p", "a.md", changed), "changed")
  // The mark keeps the blob it was made at, so the old content still counts.
  assert.equal(viewedState(marks, "/p", "a.md", blob), "viewed")
  // An unknown blob, another project, or an unmarked path was never viewed.
  assert.equal(viewedState(marks, "/p", "a.md", ""), "unviewed")
  assert.equal(viewedState(marks, "/q", "a.md", changed), "unviewed")
  assert.equal(viewedState(marks, "/p", "b.md", changed), "unviewed")
  // Marking again takes the new blob; unmarking forgets the file.
  assert.equal(viewedState(withViewed(marks, "/p", "a.md", changed, true), "/p", "a.md", changed), "viewed")
  assert.equal(viewedState(withViewed(marks, "/p", "a.md", changed, false), "/p", "a.md", changed), "unviewed")
})

test("marks stored before changed-since-viewed keep their format", () => {
  const stored = JSON.parse(JSON.stringify(withViewed({}, "/p", "a.md", blob, true)))
  assert.deepEqual(stored, { "/p": { "a.md": blob } })
  assert.equal(viewedState(parseViewed(stored), "/p", "a.md", changed), "changed")
})
