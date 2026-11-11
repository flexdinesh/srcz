import assert from "node:assert/strict"
import test from "node:test"

import {
  canGoBack, canGoForward, emptyLog, matchRecent, name, parseLog, recentLocations, resume, routeName, stepLabel, steps, visit,
  type HistoryLog, type HistoryMove,
} from "./navigation-history.ts"

const hash = "3577ec6a1b2c3d4e5f60718293a4b5c6d7e8f901"
const href = (path: string, project = "/work/zero") => `/view?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`

function walk(moves: ReadonlyArray<[HistoryMove, number, string]>, log: HistoryLog = emptyLog): HistoryLog {
  return moves.reduce((current, [move, index, target]) => visit(current, move, { index, key: `k${index}:${target}`, href: target }), log)
}

const opened = walk([["replace", 0, href("a.md")], ["push", 1, href("b.md")], ["push", 2, href("c.md")]])

test("pushes extend the history; Back and Forward follow the position", () => {
  assert.equal(canGoBack(opened), true)
  assert.equal(canGoForward(opened), false)
  const back = walk([["pop", 1, href("b.md")]], opened)
  assert.equal(back.current, 1)
  assert.equal(canGoForward(back), true)
  assert.deepEqual(steps(back, 1).map((step) => step.entry?.label), ["c.md"])
  assert.deepEqual(steps(back, -1).map((step) => [step.delta, step.entry?.label]), [[-1, "a.md"]])
})

test("a push after going back drops what Forward led to, as the browser does", () => {
  const back = walk([["pop", 1, href("b.md")], ["pop", 0, href("a.md")]], opened)
  const branched = walk([["push", 1, href("d.md")]], back)
  assert.equal(canGoForward(branched), false)
  assert.deepEqual(branched.entries.map((entry) => entry.label), ["a.md", "d.md"])
})

test("a replace rewrites the entry and keeps Forward", () => {
  const back = walk([["pop", 1, href("b.md")]], opened)
  const anchored = visit(back, "replace", { index: 1, key: "k1:b.md", href: `${href("b.md")}#L12` })
  assert.equal(anchored.top, 2)
  assert.equal(anchored.entries.find((entry) => entry.index === 1)?.href, `${href("b.md")}#L12`)
})

test("the workspace's name sticks to its entry, across line anchors", () => {
  const review = walk([["push", 3, "/view?project=%2Fwork%2Fzero&review=working"]], opened)
  assert.equal(stepLabel(null, ""), "an earlier location")
  const named = name(review, "k3:/view?project=%2Fwork%2Fzero&review=working", "Uncommitted", "Uncommitted Changes")
  assert.equal(named.entries.at(-1)?.label, "Uncommitted")
  assert.equal(name(named, "another key", "Other", "Other"), named)
  const anchored = visit(named, "replace", { index: 3, key: "k3", href: "/view?project=%2Fwork%2Fzero&review=working#f=a.md" })
  assert.equal(anchored.entries.at(-1)?.label, "Uncommitted")
})

test("routes are named before the workspace names them", () => {
  assert.deepEqual(routeName(href("web/src/App.tsx")), { label: "App.tsx", title: "web/src/App.tsx" })
  assert.equal(routeName(`${href("a.md")}&at=${hash}`).label, "a.md @ 3577ec6")
  assert.equal(routeName(`/view?project=x&commit=${hash}`).label, "Review")
  assert.equal(routeName("/view?project=x&wt=abc").label, "Walkthrough")
  assert.equal(routeName("/view?project=x&welcome=1").label, "Welcome")
  assert.equal(routeName("/?project=%2Fwork%2Fzero").label, "zero")
  // The router quotes a string that would parse as JSON.
  assert.equal(routeName(`/view?project=x&path=${encodeURIComponent("\"123\"")}`).label, "123")
})

test("another project's entry names its project", () => {
  const crossed = walk([["push", 3, href("main.go", "/work/other")]], opened)
  const entry = crossed.entries.at(-1) ?? null
  assert.equal(stepLabel(entry, "/work/zero"), "main.go in other")
  assert.equal(stepLabel(entry, "/work/other"), "main.go")
})

test("Recent Locations lists each place once, most recently shown first, without the one on screen", () => {
  const revisited = walk([["pop", 0, href("a.md")], ["pop", 2, href("c.md")]], opened)
  assert.deepEqual(recentLocations(revisited).map((entry) => entry.label), ["a.md", "b.md"])
  const anchored = walk([["push", 3, `${href("a.md")}#L4`]], revisited)
  assert.deepEqual(recentLocations(anchored).map((entry) => entry.label), ["c.md", "b.md"])
  assert.deepEqual(matchRecent(recentLocations(revisited), "B.M").map((entry) => entry.label), ["b.md"])
})

test("lists stop at their limit and at the ends", () => {
  const long = walk(Array.from({ length: 20 }, (_, index): [HistoryMove, number, string] => [index ? "push" : "replace", index, href(`${index}.md`)]))
  assert.equal(steps(long, -1).length, 12)
  assert.equal(steps(long, -1).at(-1)?.delta, -12)
  assert.equal(steps(long, 1).length, 0)
})

test("a reload resumes the stored log; another history starts over", () => {
  const back = walk([["pop", 1, href("b.md")]], opened)
  const stored = parseLog(JSON.parse(JSON.stringify(back)))
  assert.deepEqual(stored, back)
  const resumed = resume(stored, { index: 1, key: "k1:" + href("b.md"), href: href("b.md") })
  assert.equal(canGoForward(resumed), true)
  const fresh = resume(stored, { index: 1, key: "elsewhere", href: href("z.md") })
  assert.equal(canGoForward(fresh), false)
  assert.equal(canGoBack(fresh), true)
  assert.deepEqual(fresh.entries.map((entry) => entry.label), ["z.md"])
})

test("malformed storage reads as an empty log", () => {
  for (const value of [null, "x", { entries: "no" }, { entries: [], current: 3, top: 1, clock: 0 },
    { entries: [{ index: -1 }], current: 0, top: 0, clock: 0 }]) {
    assert.deepEqual(parseLog(value), emptyLog)
  }
})
