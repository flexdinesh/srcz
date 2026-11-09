import assert from "node:assert/strict"
import test from "node:test"

import type { StackLayer, StackResponse } from "@zero/contracts"
import type { Compare } from "./compare.ts"
import type { CompareFile } from "./compare-files.ts"
import { detailsFiles, diffGlyph, fileParts, moreFilesLabel, onBaseBranch, refChips, stackRows } from "./source-control-panes.ts"

const a = "a".repeat(40)
const b = "b".repeat(40)
const c = "c".repeat(40)

function layer(name: string, head: string, parent: string, current = false, aliases: string[] = []): StackLayer {
  return { name, aliases, head, parent, ahead: 1, current }
}

function stack(layers: StackLayer[]): StackResponse {
  return { repository: true, branch: "feat-b", base: "main", mergeBase: "", head: b, layers, truncated: false }
}

test("HEAD on the base branch, or tracking origin's copy, lists all history", () => {
  assert.equal(onBaseBranch("main", "main"), true)
  assert.equal(onBaseBranch("main", "origin/main"), true)
  assert.equal(onBaseBranch("feat", "main"), false)
  assert.equal(onBaseBranch("", "main"), false)
  assert.equal(onBaseBranch("main", ""), false)
})

test("the diff glyph sits on a range's newest commit, and on any other commit", () => {
  const range: Compare = { kind: "range", from: c, to: a }
  assert.deepEqual(diffGlyph(a, range, [a, b, c]), { compare: range, pinned: true })
  assert.equal(diffGlyph(b, range, [a, b, c]), null)
  assert.deepEqual(diffGlyph("d".repeat(40), range, [a, b, c]), { compare: { kind: "commit", hash: "d".repeat(40) }, pinned: false })
  assert.deepEqual(diffGlyph(a, { kind: "commit", hash: a }, [a]), { compare: { kind: "commit", hash: a }, pinned: true })
  assert.deepEqual(diffGlyph(a, null, []), { compare: { kind: "commit", hash: a }, pinned: false })
})

function file(path: string): CompareFile {
  return { path, status: "modified" }
}

test("commit details list the first files in review order, then how many more", () => {
  const files = [file("b.ts"), file("src/a.ts"), file("a.ts")]
  assert.deepEqual(detailsFiles(files, false, 2), { shown: [file("src/a.ts"), file("a.ts")], more: 1, truncated: false })
  assert.deepEqual(detailsFiles(files, false), { shown: [file("src/a.ts"), file("a.ts"), file("b.ts")], more: 0, truncated: false })
  assert.equal(detailsFiles(Array.from({ length: 25 }, (_, index) => file(`f${index}.ts`)), false).shown.length, 20)
})

test("the row after capped details names how many files remain", () => {
  assert.equal(moreFilesLabel({ shown: [], more: 0, truncated: false }), "")
  assert.equal(moreFilesLabel({ shown: [], more: 1, truncated: false }), "1 more file")
  assert.equal(moreFilesLabel({ shown: [], more: 1200, truncated: false }), "1,200 more files")
  assert.equal(moreFilesLabel({ shown: [], more: 1, truncated: true }), "1+ more files")
  assert.equal(moreFilesLabel({ shown: [], more: 0, truncated: true }), "More files")
})

test("stack layers name their commits, current first", () => {
  const chips = refChips(stack([layer("feat-c", c, "feat-b"), layer("feat-b", b, "feat-a", true, ["feat-b2"]), layer("", a, "main", false)]))
  assert.deepEqual(chips.get(b), [{ name: "feat-b", current: true }, { name: "feat-b2", current: false }])
  assert.deepEqual(chips.get(c), [{ name: "feat-c", current: false }])
  assert.equal(chips.has(a), false)
  assert.equal(refChips(null).size, 0)
})

test("stack rows diff each layer against the one below, and everything against the base", () => {
  const rows = stackRows(stack([layer("feat-c", c, "feat-b"), layer("feat-b", b, "feat-a", true), layer("feat-a", a, "main")]), "")
  assert.deepEqual(rows.map((row) => row.layerDiff), [
    { kind: "branch", base: "feat-b", head: "feat-c", uncommitted: false },
    { kind: "branch", base: "feat-a", head: "", uncommitted: false },
    null,
  ])
  assert.deepEqual(rows.map((row) => row.baseDiff), [
    { kind: "branch", base: "", head: "feat-c", uncommitted: false },
    { kind: "branch", base: "", head: "", uncommitted: false },
    { kind: "branch", base: "", head: "feat-a", uncommitted: false },
  ])
  assert.deepEqual(stackRows(null, ""), [])
})

test("flat change rows split names from folders", () => {
  assert.deepEqual(fileParts("web/src/App.tsx"), { name: "App.tsx", folder: "web/src" })
  assert.deepEqual(fileParts("README.md"), { name: "README.md", folder: "" })
})
