import assert from "node:assert/strict"
import test from "node:test"

import type { ChangedFile, DiffResponse, FileType, PageData } from "@zero/contracts"
import {
  changeMarkers, diffMarkers, markerLabel, markerLine, markerRows, markerSizeLimit, markerSource, wholeMarkers, type ChangeMarker,
} from "./change-markers.ts"
import { lineDiffOf } from "./line-diff-testing.ts"

function numbered(count: number, change: (line: number) => string[] = (line) => [`line ${line}`]): string {
  return Array.from({ length: count }, (_, index) => change(index + 1).map((value) => `${value}\n`).join("")).join("")
}

function markers(before: string, after: string): ChangeMarker[] {
  return changeMarkers(lineDiffOf(before, after))
}

const original = numbered(20)

test("an empty diff has no markers", () => {
  assert.deepEqual(markers(original, original), [])
})

test("inserted lines are added, on the new side", () => {
  assert.deepEqual(markers(original, numbered(20, (line) => line === 1 ? ["new", "line 1"] : [`line ${line}`])),
    [{ kind: "added", start: 1, end: 1 }])
  assert.deepEqual(markers(original, numbered(20, (line) => line === 10 ? ["line 10", "a", "b", "c"] : [`line ${line}`])),
    [{ kind: "added", start: 11, end: 13 }])
  assert.deepEqual(markers(original, `${original}tail\n`), [{ kind: "added", start: 21, end: 21 }])
})

test("replaced lines are modified, spanning their new lines", () => {
  assert.deepEqual(markers(original, numbered(20, (line) => line === 5 ? ["five", "FIVE"] : [`line ${line}`])),
    [{ kind: "modified", start: 5, end: 6 }])
  assert.deepEqual(markers(original, numbered(20, (line) => line === 1 ? ["one"] : line === 20 ? ["twenty"] : [`line ${line}`])),
    [{ kind: "modified", start: 1, end: 1 }, { kind: "modified", start: 20, end: 20 }])
})

test("removed lines are deleted between new lines", () => {
  assert.deepEqual(markers(original, numbered(20, (line) => line <= 2 ? [] : [`line ${line}`])),
    [{ kind: "deleted", after: 0, lines: 2 }])
  assert.deepEqual(markers(original, numbered(20, (line) => line === 10 ? [] : [`line ${line}`])),
    [{ kind: "deleted", after: 9, lines: 1 }])
  assert.deepEqual(markers(original, numbered(17)), [{ kind: "deleted", after: 17, lines: 3 }])
})

test("mixed blocks keep file order across hunks", () => {
  const edited = numbered(20, (line) => {
    if (line === 2) return ["line 2", "inserted"]
    if (line === 4) return ["four"]
    if (line === 6) return []
    if (line === 18) return ["eighteen"]
    return [`line ${line}`]
  })
  assert.deepEqual(markers(original, edited), [
    { kind: "added", start: 3, end: 3 },
    { kind: "modified", start: 5, end: 5 },
    { kind: "deleted", after: 6, lines: 1 },
    { kind: "modified", start: 18, end: 18 },
  ])
})

test("labels name the change and its lines in words", () => {
  assert.equal(markerLabel({ kind: "added", start: 3, end: 5 }), "Added lines 3–5")
  assert.equal(markerLabel({ kind: "added", start: 3, end: 3 }), "Added line 3")
  assert.equal(markerLabel({ kind: "modified", start: 8, end: 9 }), "Modified lines 8–9")
  assert.equal(markerLabel({ kind: "deleted", after: 7, lines: 2 }), "Deleted 2 lines after line 7")
  assert.equal(markerLabel({ kind: "deleted", after: 0, lines: 1 }), "Deleted 1 line before line 1")
})

test("a marker opens the review at its first new line", () => {
  assert.equal(markerLine({ kind: "modified", start: 8, end: 9 }), 8)
  assert.equal(markerLine({ kind: "deleted", after: 7, lines: 2 }), 7)
  assert.equal(markerLine({ kind: "deleted", after: 0, lines: 2 }), 1)
})

test("rows carry bar segments and wedges on row edges", () => {
  const rows = markerRows([
    { kind: "deleted", after: 0, lines: 1 },
    { kind: "added", start: 2, end: 3 },
    { kind: "deleted", after: 5, lines: 2 },
    { kind: "modified", start: 9, end: 12 },
    { kind: "deleted", after: 10, lines: 1 },
  ], 10)
  assert.deepEqual(rows.get(1), { wedge: { marker: { kind: "deleted", after: 0, lines: 1 }, edge: "start" } })
  assert.equal(rows.get(2)?.bar?.first, true)
  assert.equal(rows.get(3)?.bar?.first, false)
  assert.equal(rows.get(4), undefined)
  assert.equal(rows.get(6)?.wedge?.edge, "between")
  assert.equal(rows.get(10)?.bar?.marker.kind, "modified")
  assert.equal(rows.get(10)?.wedge?.edge, "end")
  assert.equal(rows.has(11), false)
  assert.equal(markerRows([{ kind: "added", start: 1, end: 1 }], 0).size, 0)
})

const documentType: FileType = {
  id: "ts", label: "TypeScript", extensions: [".ts"], filenames: [], language: "typescript",
  previewKind: "", previewLabel: "", defaultMode: "source", formattable: false,
}

const page: PageData = {
  roots: [], sessionKey: "", project: "p", projectUnavailable: false, rootName: "", repository: "p", projectKind: "repo",
  branch: "main", worktrees: 1, tree: [], selected: "src/app.ts", at: "", content: "", source: "a\nb\n", fileSize: 4, fileCount: 1,
  hasFile: true, empty: false, error: "", warnings: [], documentType, navigationSupported: false, binary: false, tooLarge: false,
  previewDisabled: false, highlightDisabled: false, searchExcluded: false, previewError: "",
}
const modified: ChangedFile = { path: "src/app.ts", status: "modified" }

test("only working-tree text files in the change set show markers", () => {
  assert.deepEqual(markerSource(page, modified), { kind: "diff", file: modified })
  assert.deepEqual(markerSource(page, { path: "src/app.ts", oldPath: "app.ts", status: "renamed" }).kind, "diff")
  assert.deepEqual(markerSource(page, { path: "src/app.ts", status: "untracked" }), { kind: "whole" })
  assert.deepEqual(markerSource(page, { path: "src/app.ts", status: "added" }), { kind: "whole" })
  assert.deepEqual(markerSource(page, undefined), { kind: "none" })
  assert.deepEqual(markerSource(page, { path: "other.ts", status: "modified" }), { kind: "none" })
  assert.deepEqual(markerSource(page, { path: "src/app.ts", status: "deleted" }), { kind: "none" })
  assert.deepEqual(markerSource({ ...page, at: "a".repeat(40) }, modified), { kind: "none" })
  assert.deepEqual(markerSource({ ...page, binary: true }, modified), { kind: "none" })
  assert.deepEqual(markerSource({ ...page, fileSize: markerSizeLimit + 1 }, modified), { kind: "none" })
  assert.deepEqual(markerSource({ ...page, hasFile: false }, modified), { kind: "none" })
})

test("a new file is added whole", () => {
  assert.deepEqual(wholeMarkers("a\nb\n"), [{ kind: "added", start: 1, end: 2 }])
  assert.deepEqual(wholeMarkers("a"), [{ kind: "added", start: 1, end: 1 }])
  assert.deepEqual(wholeMarkers(""), [])
})

test("a diff places markers only on the text it was read for", () => {
  const side = (content: string) => ({ content, size: content.length, binary: false, tooLarge: false })
  const diff: DiffResponse = {
    path: "src/app.ts", status: "modified", documentType, original: side("a\n"), modified: side("a\nb\n"), lineDiff: lineDiffOf("a\n", "a\nb\n"),
  }
  assert.deepEqual(diffMarkers(diff, "a\nb\n"), [{ kind: "added", start: 2, end: 2 }])
  assert.equal(diffMarkers(diff, "a\nb\nc\n"), null)
  assert.equal(diffMarkers({ ...diff, lineDiff: null }, "a\nb\n"), null)
})
