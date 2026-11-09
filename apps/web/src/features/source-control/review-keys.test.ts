import assert from "node:assert/strict"
import test from "node:test"

import { adjacentFile, nextUnviewed, reviewKeyCommand, type ReviewKeyEvent } from "./review-keys.ts"

const plain: ReviewKeyEvent = { key: "", altKey: false, ctrlKey: false, metaKey: false, isComposing: false, textField: false }

test("] and [ move between files and v toggles Viewed", () => {
  assert.equal(reviewKeyCommand({ ...plain, key: "]" }), "nextFile")
  assert.equal(reviewKeyCommand({ ...plain, key: "[" }), "previousFile")
  assert.equal(reviewKeyCommand({ ...plain, key: "v" }), "toggleViewed")
  assert.equal(reviewKeyCommand({ ...plain, key: "V" }), null)
  assert.equal(reviewKeyCommand({ ...plain, key: "j" }), null)
})

test("review keys never fire in text fields, while composing, or with modifiers", () => {
  for (const key of ["]", "[", "v"]) {
    assert.equal(reviewKeyCommand({ ...plain, key, textField: true }), null)
    assert.equal(reviewKeyCommand({ ...plain, key, isComposing: true }), null)
    assert.equal(reviewKeyCommand({ ...plain, key, ctrlKey: true }), null)
    assert.equal(reviewKeyCommand({ ...plain, key, metaKey: true }), null)
    assert.equal(reviewKeyCommand({ ...plain, key, altKey: true }), null)
  }
})

test("adjacent files follow review order without wrapping", () => {
  const paths = ["src/a.ts", "src/b.ts", "README.md"]
  assert.equal(adjacentFile(paths, "src/a.ts", 1), "src/b.ts")
  assert.equal(adjacentFile(paths, "src/b.ts", -1), "src/a.ts")
  assert.equal(adjacentFile(paths, "README.md", 1), null)
  assert.equal(adjacentFile(paths, "src/a.ts", -1), null)
  assert.equal(adjacentFile(paths, "", 1), "src/a.ts")
  assert.equal(adjacentFile(paths, "gone.md", -1), "README.md")
  assert.equal(adjacentFile([], "", 1), null)
})

test("the next unviewed file follows the marked one, wrapping, never itself", () => {
  const paths = ["a", "b", "c", "d"]
  const viewed = new Set(["b", "c"])
  const unviewed = (path: string) => !viewed.has(path)
  assert.equal(nextUnviewed(paths, "a", unviewed), "d")
  assert.equal(nextUnviewed(paths, "d", unviewed), "a")
  assert.equal(nextUnviewed(paths, "c", unviewed), "d")
  assert.equal(nextUnviewed(paths, "a", (path) => path === "a"), null)
  assert.equal(nextUnviewed(paths, "gone", unviewed), "a")
  assert.equal(nextUnviewed([], "a", unviewed), null)
})
