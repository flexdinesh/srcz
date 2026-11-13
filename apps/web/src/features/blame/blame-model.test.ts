import assert from "node:assert/strict"
import test from "node:test"

import type { BlameCommitInfo, BlameResponse, PageData } from "@zero/contracts"
import {
  blameAvailable, blameLabel, blameMonth, blameRange, blameText, blameUrl, lineBlame, originalLine, type LineBlame,
} from "./blame-model.ts"

const ada: BlameCommitInfo = {
  hash: "3577ec6f1d2e4b8a9c0d7e6f5a4b3c2d1e0f9a8b",
  subject: "Greet by name",
  body: "",
  author: { name: "Ada Lovelace", email: "ada@example.com" },
  authorTime: "2026-11-10T09:30:00+01:00",
}

const old: BlameCommitInfo = {
  hash: "4f76e9a2b3c4d5e6f708192a3b4c5d6e7f8091a2",
  subject: "Initial import",
  body: "",
  author: { name: "Grace Hopper", email: "grace@example.com" },
  authorTime: "2024-03-15T12:00:00-05:00",
}

// Lines 1-3 come from ada (lines 10-12 there), 4-5 are uncommitted, and
// 6-7 stop at the old boundary commit (lines 1-2 there).
const response: BlameResponse = {
  repository: true,
  path: "navigation/greet.go",
  commit: ada.hash,
  lineCount: 7,
  ranges: [
    { start: 1, count: 3, kind: "commit", commit: 0, originalLine: 10 },
    { start: 4, count: 2, kind: "uncommitted", commit: -1, originalLine: 0 },
    { start: 6, count: 2, kind: "boundary", commit: 1, originalLine: 1 },
  ],
  commits: [ada, old],
  truncated: true,
}

const now = Date.parse("2026-11-13T09:30:00Z")

test("a line finds the range that holds it", () => {
  assert.equal(blameRange(response.ranges, 1), response.ranges[0])
  assert.equal(blameRange(response.ranges, 3), response.ranges[0])
  assert.equal(blameRange(response.ranges, 4), response.ranges[1])
  assert.equal(blameRange(response.ranges, 7), response.ranges[2])
  assert.equal(blameRange(response.ranges, 0), null)
  assert.equal(blameRange(response.ranges, 8), null)
  assert.equal(blameRange([], 1), null)
})

test("a line inside a range keeps its offset in the commit", () => {
  const [first, uncommitted, boundary] = response.ranges
  assert.ok(first && uncommitted && boundary)
  assert.equal(originalLine(first, 1), 10)
  assert.equal(originalLine(first, 3), 12)
  assert.equal(originalLine(uncommitted, 5), 0)
  assert.equal(originalLine(boundary, 7), 2)
})

test("lines attribute to their commit, uncommitted changes, or the boundary", () => {
  assert.deepEqual(lineBlame(response, 2, 7), { line: 2, kind: "commit", commit: ada, originalLine: 11 })
  assert.deepEqual(lineBlame(response, 5, 7), { line: 5, kind: "uncommitted", commit: null, originalLine: 0 })
  assert.deepEqual(lineBlame(response, 6, 7), { line: 6, kind: "boundary", commit: old, originalLine: 1 })
})

test("a response for other text, a folder, or a missing commit attributes nothing", () => {
  assert.equal(lineBlame(response, 2, 8), null)
  assert.equal(lineBlame(response, 9, 7), null)
  assert.equal(lineBlame({ ...response, repository: false, ranges: [], commits: [], lineCount: 7 }, 1, 7), null)
  assert.equal(lineBlame({ ...response, commits: [ada] }, 6, 7), null)
})

test("the inline label names author and age, uncommitted changes, or the cut-off", () => {
  const blame = (line: number): LineBlame => {
    const value = lineBlame(response, line, 7)
    assert.ok(value)
    return value
  }
  assert.equal(blameText(blame(1), now), "Ada Lovelace, 3 days ago · Greet by name")
  assert.equal(blameText(blame(4), now), "Uncommitted changes")
  assert.equal(blameText(blame(7), now), "Older than 4f76e9a · Mar 2024")
  assert.equal(blameLabel(blame(4), now), "Blame for line 4: Uncommitted changes")
})

test("the boundary month is the author's own", () => {
  assert.equal(blameMonth("2024-12-31T23:30:00-05:00"), "Dec 2024")
  assert.equal(blameMonth("2025-01-01T00:30:00+09:00"), "Jan 2025")
  assert.equal(blameMonth("not a time"), "")
})

test("blame reads the working tree or a snapshot", () => {
  assert.equal(blameUrl("/work", "a b.go", ""), "/api/blame?project=%2Fwork&path=a+b.go")
  assert.equal(blameUrl("/work", "a.go", ada.hash), `/api/blame?project=%2Fwork&path=a.go&at=${ada.hash}`)
})

test("only text files within the preview limit show blame", () => {
  const page: PageData = {
    roots: [], sessionKey: "", project: "p", projectUnavailable: false, rootName: "", repository: "p", projectKind: "repo",
    branch: "main", worktrees: 1, tree: [], selected: "a.go", at: "", content: "", source: "a\n", fileSize: 2, fileCount: 1,
    hasFile: true, empty: false, error: "", warnings: [], documentType: null, navigationSupported: false, binary: false, tooLarge: false,
    previewDisabled: false, highlightDisabled: false, searchExcluded: false, previewError: "",
  }
  assert.equal(blameAvailable(page), true)
  assert.equal(blameAvailable({ ...page, binary: true }), false)
  assert.equal(blameAvailable({ ...page, tooLarge: true }), false)
  assert.equal(blameAvailable({ ...page, previewDisabled: true }), false)
  assert.equal(blameAvailable({ ...page, hasFile: false }), false)
})
