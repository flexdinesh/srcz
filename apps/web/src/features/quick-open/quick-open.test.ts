import assert from "node:assert/strict"
import test from "node:test"

import { indexFiles, matchFiles, parseQuickOpenQuery, recentFiles, splitPath } from "./quick-open.ts"
import { emptyLog, visit, type HistoryLog, type HistoryMove } from "../../workspace/navigation-history.ts"

const paths = [
  "README.md",
  "apps/web/src/App.tsx",
  "apps/web/src/features/explorer/FileTree.tsx",
  "apps/web/src/features/explorer/filename-filter.ts",
  "apps/web/src/features/explorer/filename-filter.test.ts",
  "apps/web/src/lib/tree-css.ts",
  "apps/web/src/lib/tree-icons.ts",
  "apps/web/src/workspace/CommandPalette.tsx",
  "apps/web/src/workspace/command-palette.css",
  "apps/zero/internal/app/app.go",
  "docs/decisions/0006-explorer-filename-filter.md",
]
const index = indexFiles(paths)
const ranked = (query: string, limit = 20) => matchFiles(index, query.toLowerCase().split(/\s+/).filter(Boolean), limit).matches.map((match) => match.path)

test("the query reads files, a file at a line, a line, or commands", () => {
  assert.deepEqual(parseQuickOpenQuery("tree css"), { kind: "files", terms: ["tree", "css"], line: null })
  assert.deepEqual(parseQuickOpenQuery("App.tsx:42"), { kind: "files", terms: ["app.tsx"], line: 42 })
  assert.deepEqual(parseQuickOpenQuery("app.tsx:42:7"), { kind: "files", terms: ["app.tsx"], line: 42 })
  assert.deepEqual(parseQuickOpenQuery(":42"), { kind: "line", line: 42 })
  assert.deepEqual(parseQuickOpenQuery(" :12 "), { kind: "line", line: 12 })
  assert.deepEqual(parseQuickOpenQuery(">open set"), { kind: "commands", text: "open set" })
  assert.deepEqual(parseQuickOpenQuery(">"), { kind: "commands", text: "" })
})

test("text that is not a line number stays part of the name", () => {
  assert.deepEqual(parseQuickOpenQuery(":abc"), { kind: "files", terms: [":abc"], line: null })
  assert.deepEqual(parseQuickOpenQuery("a.ts:0"), { kind: "files", terms: ["a.ts:0"], line: null })
  assert.deepEqual(parseQuickOpenQuery(""), { kind: "files", terms: [], line: null })
})

test("a base-name prefix ranks above a base-name substring, which ranks above a folder hit", () => {
  assert.deepEqual(ranked("tree").slice(0, 3), ["apps/web/src/lib/tree-css.ts", "apps/web/src/lib/tree-icons.ts", "apps/web/src/features/explorer/FileTree.tsx"])
  assert.deepEqual(ranked("app").slice(0, 3), ["apps/web/src/App.tsx", "apps/zero/internal/app/app.go", "apps/web/src/lib/tree-css.ts"])
})

test("in-order characters find a file, preferring word starts in the base name", () => {
  assert.equal(ranked("flfil")[0], "apps/web/src/features/explorer/filename-filter.ts")
  assert.equal(ranked("cmdpal")[0], "apps/web/src/workspace/CommandPalette.tsx")
})

test("every term must match; terms may match anywhere in the path", () => {
  assert.equal(ranked("tree css")[0], "apps/web/src/lib/tree-css.ts")
  assert.equal(ranked("explorer test")[0], "apps/web/src/features/explorer/filename-filter.test.ts")
  assert.deepEqual(ranked("readme go"), [])
  assert.deepEqual(ranked("zzqq"), [])
})

test("ties go to the shorter path, then path order", () => {
  assert.deepEqual(ranked("filename-filter"), [
    "apps/web/src/features/explorer/filename-filter.ts",
    "apps/web/src/features/explorer/filename-filter.test.ts",
    "docs/decisions/0006-explorer-filename-filter.md",
  ])
})

test("matches carry highlight ranges for the name and the folder", () => {
  const [match] = matchFiles(index, ["tree", "lib"], 1).matches
  assert.equal(match?.path, "apps/web/src/lib/tree-css.ts")
  assert.deepEqual(match?.name, [{ start: 0, end: 4 }])
  assert.deepEqual(match?.directory, [{ start: 13, end: 16 }])
})

test("matching is case-insensitive and highlights the original text", () => {
  const [match] = matchFiles(index, ["filetree"], 1).matches
  assert.equal(match?.path, "apps/web/src/features/explorer/FileTree.tsx")
  assert.deepEqual(match?.name, [{ start: 0, end: 8 }])
})

test("results stop at the limit while the total counts every match", () => {
  const result = matchFiles(index, ["a"], 3)
  assert.equal(result.matches.length, 3)
  assert.equal(result.total, paths.filter((path) => path.toLowerCase().includes("a")).length)
})

test("an empty query matches nothing", () => {
  assert.deepEqual(matchFiles(index, [], 10), { total: 0, matches: [] })
})

test("splitPath separates the folder from the base name", () => {
  assert.deepEqual(splitPath("a/b/c.ts"), { directory: "a/b", name: "c.ts" })
  assert.deepEqual(splitPath("c.ts"), { directory: "", name: "c.ts" })
})

const project = "/work/zero"
const href = (path: string, extra = "", where = project) => `/view?project=${encodeURIComponent(where)}&path=${encodeURIComponent(path)}${extra}`

function walk(moves: ReadonlyArray<[HistoryMove, number, string]>): HistoryLog {
  return moves.reduce((log, [move, at, target]) => visit(log, move, { index: at, key: `k${at}`, href: target }), emptyLog)
}

test("recent files are this project's files, most recent first, without the current one", () => {
  const log = walk([
    ["replace", 0, href("README.md")],
    ["push", 1, href("apps/web/src/App.tsx")],
    ["push", 2, href("gone.ts")],
    ["push", 3, href("apps/web/src/lib/tree-css.ts", "&at=3577ec6a1b2c3d4e5f60718293a4b5c6d7e8f901")],
    ["push", 4, href("other.md", "", "/work/other")],
    ["push", 5, `${href("apps/web/src/App.tsx")}#L12`],
    ["push", 6, href("apps/web/src/features/explorer/FileTree.tsx")],
  ])
  const files = new Set(paths)
  assert.deepEqual(recentFiles(log, project, files, "apps/web/src/features/explorer/FileTree.tsx"), ["apps/web/src/App.tsx", "README.md"])
})

test("matching 50,000 paths stays fast enough for every keystroke", () => {
  const many = Array.from({ length: 50_000 }, (_, at) => `packages/module-${at % 97}/src/feature-${at % 389}/component-${at}.tsx`)
  const big = indexFiles(many)
  const runs: number[] = []
  for (const query of [["comp"], ["fea", "12"], ["mdcmp9"], ["zzzz"], ["src", "component-4"]]) {
    const start = performance.now()
    matchFiles(big, query, 100)
    runs.push(performance.now() - start)
  }
  const median = runs.toSorted((a, b) => a - b)[Math.floor(runs.length / 2)] ?? 0
  console.log(`quick open: median ${median.toFixed(1)}ms over 50,000 paths`)
  assert.ok(median < 60, `median ${median.toFixed(1)}ms`)
})
