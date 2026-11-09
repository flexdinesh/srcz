import assert from "node:assert/strict"
import test from "node:test"

import type { CompareFile } from "./compare-files.ts"
import { emptyFilterMessage, filesFilterActive, filterFiles } from "./files-filter.ts"

const files: CompareFile[] = [
  { path: "src/app/Main.tsx", status: "modified" },
  { path: "src/lib/util.ts", status: "added" },
  { path: "guides/start.md", oldPath: "guides/intro.md", status: "renamed" },
  { path: "README.md", status: "modified" },
]
const paths = (shown: readonly CompareFile[]) => shown.map((file) => file.path)
const none = () => false

test("an empty filter keeps every file", () => {
  assert.equal(filterFiles(files, { query: "  ", hideViewed: false }, none), files)
  assert.equal(filesFilterActive({ query: " ", hideViewed: false }), false)
})

test("path terms match anywhere in the path, ignoring case, all of them", () => {
  assert.deepEqual(paths(filterFiles(files, { query: "main", hideViewed: false }, none)), ["src/app/Main.tsx"])
  assert.deepEqual(paths(filterFiles(files, { query: "src .ts", hideViewed: false }, none)), ["src/app/Main.tsx", "src/lib/util.ts"])
  assert.deepEqual(paths(filterFiles(files, { query: "src md", hideViewed: false }, none)), [])
  assert.equal(filesFilterActive({ query: "src", hideViewed: false }), true)
})

test("a rename matches by its old path too", () => {
  assert.deepEqual(paths(filterFiles(files, { query: "intro", hideViewed: false }, none)), ["guides/start.md"])
})

test("Hide viewed drops viewed files and combines with terms", () => {
  const viewed = (path: string) => path === "README.md" || path === "src/lib/util.ts"
  assert.deepEqual(paths(filterFiles(files, { query: "", hideViewed: true }, viewed)), ["src/app/Main.tsx", "guides/start.md"])
  assert.deepEqual(paths(filterFiles(files, { query: "md", hideViewed: true }, viewed)), ["guides/start.md"])
  assert.equal(filesFilterActive({ query: "", hideViewed: true }), true)
})

test("an empty result says why", () => {
  assert.equal(emptyFilterMessage({ query: "zzz", hideViewed: true }), "No files match.")
  assert.equal(emptyFilterMessage({ query: "", hideViewed: true }), "Every file is viewed.")
})
