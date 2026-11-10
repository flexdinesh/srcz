import assert from "node:assert/strict"
import test from "node:test"

import type { FileStats } from "@zero/contracts"
import { pureRename } from "./diff-stats.ts"
import { fileDecoration, threadsCSS, viewedCSS } from "./files-tree-decoration.ts"

test("counted stats report additions and deletions, including zero", () => {
  assert.equal(fileDecoration({ path: "a.ts", status: "counted", additions: 1200, deletions: 0, blob: "b" }, undefined)?.text, "+1,200 −0")
  assert.equal(fileDecoration({ path: "a.ts", status: "counted", additions: 0, deletions: 3, blob: "b" }, undefined)?.text, "+0 −3")
})

test("uncounted files read as plain notes", () => {
  assert.equal(fileDecoration({ path: "logo.bin", status: "binary", blob: "" }, undefined)?.text, "binary")
  assert.equal(fileDecoration({ path: "big.txt", status: "tooLarge", blob: "" }, undefined)?.text, "large")
})

test("renamed files say where they came from until stats arrive", () => {
  assert.ok(fileDecoration(undefined, "old/start.md")?.text.includes("old/start.md"))
  assert.ok(fileDecoration({ path: "start.md", status: "counted", additions: 0, deletions: 0, blob: "b" }, "old/start.md")?.title.includes("old/start.md"))
})

test("files without stats or a rename have no decoration", () => {
  assert.equal(fileDecoration(undefined, undefined), null)
  assert.equal(fileDecoration({ path: "a.ts", status: "budget", blob: "" }, undefined), null)
})

test("files with uncommitted edits retain their mark with and without stats", () => {
  assert.equal(fileDecoration({ path: "a.ts", status: "counted", additions: 2, deletions: 0, blob: "b" }, undefined, { marked: true })?.text, "● +2 −0")
  assert.equal(fileDecoration(undefined, undefined, { marked: true })?.text, "●")
})

test("viewed files retain their status with and without stats", () => {
  for (const decoration of [
    fileDecoration({ path: "a.ts", status: "counted", additions: 2, deletions: 1, blob: "b" }, undefined, { viewed: true }),
    fileDecoration({ path: "logo.bin", status: "binary", blob: "b" }, undefined, { viewed: true }),
    fileDecoration(undefined, undefined, { viewed: true }),
  ]) assert.ok(decoration?.title.includes("Viewed"))
})

test("a marked, viewed file names both marks", () => {
  const title = fileDecoration({ path: "a.ts", status: "counted", additions: 1, deletions: 1, blob: "b" }, "old.ts", { marked: true, viewed: true })?.title
  for (const detail of ["uncommitted", "old.ts", "+1 −1", "Viewed"]) assert.ok(title?.includes(detail))
})

test("viewed CSS quotes hostile paths and excludes selected rows from dimming", () => {
  assert.equal(viewedCSS([]), "")
  const css = viewedCSS(['odd"name\\\n].md'])
  const selector = '[data-item-path="odd\\"name\\\\\\a ].md"]'
  assert.ok(css.includes(`${selector}) > [data-item-section="decoration"]::before`))
  assert.ok(css.includes(`${selector}:not([data-item-selected])`))
  assert.ok(!css.includes('odd"name'))
})

test("a rename without line changes reads renamed, not +0 −0", () => {
  const stats: FileStats = { path: "start.md", status: "counted", additions: 0, deletions: 0, blob: "b" }
  const decoration = fileDecoration(stats, "old/start.md")
  assert.equal(decoration?.text, "renamed")
  assert.deepEqual(decoration?.parts, [{ text: "renamed", color: "var(--color-text-muted)" }])
  assert.ok(decoration?.title.includes("Renamed from old/start.md"))
  assert.ok(!decoration?.title.includes("+0"))
  // A rename with line changes keeps its stats; so does an unrenamed file.
  assert.equal(fileDecoration({ ...stats, additions: 2 }, "old/start.md")?.text, "+2 −0")
  assert.equal(fileDecoration(stats, undefined)?.text, "+0 −0")
  assert.equal(fileDecoration(stats, "old/start.md", { marked: true })?.text, "● renamed")
})

test("pureRename needs a rename and counted zero lines", () => {
  const stats: FileStats = { path: "a.md", status: "counted", additions: 0, deletions: 0, blob: "b" }
  assert.equal(pureRename(stats, "b.md"), true)
  assert.equal(pureRename(stats, undefined), false)
  assert.equal(pureRename({ ...stats, deletions: 1 }, "b.md"), false)
  assert.equal(pureRename({ path: "a.md", status: "binary", blob: "b" }, "b.md"), false)
  assert.equal(pureRename(undefined, "b.md"), false)
})

test("open threads lead the decoration with their count, before marks and stats", () => {
  const decoration = fileDecoration({ path: "a.ts", status: "counted", additions: 2, deletions: 1, blob: "b" }, undefined, { marked: true, threads: 3 })
  assert.equal(decoration?.text, "3 ● +2 −1")
  assert.deepEqual(decoration?.parts?.[0], { text: "3", color: "var(--color-text-muted)" })
  assert.ok(decoration?.title.startsWith("3 open threads"))
  assert.deepEqual(fileDecoration(undefined, undefined, { threads: 1 }), { text: "1", title: "1 open thread", parts: [{ text: "1", color: "var(--color-text-muted)" }] })
  assert.equal(fileDecoration(undefined, undefined, { threads: 0 }), null)
})

test("threads CSS draws the icon on the count of each quoted path", () => {
  assert.equal(threadsCSS([]), "")
  const css = threadsCSS(['odd"name.md'])
  assert.ok(css.includes('[data-item-path="odd\\"name.md"]) > [data-item-section="decoration"] > span > span:first-child::before'))
  assert.ok(css.includes("mask: url("))
})
