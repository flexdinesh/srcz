import assert from "node:assert/strict"
import test from "node:test"

import type { CommitsResponse } from "@zero/contracts"
import {
  appliedFilter, closedFilter, emptyHistoryMessage, fileHistory, filterAnnouncement, isFiltered, moreLabel, sameHistoryFilter,
} from "./commit-filter.ts"

function page(change: Partial<CommitsResponse> = {}): CommitsResponse {
  return {
    repository: true, branch: "feature", base: "main", range: "branch", query: "", path: "", head: "a".repeat(40), ahead: 0,
    commits: [], more: false, next: 0, ...change,
  }
}

test("a closed row filters nothing; an open one sends the trimmed query and path", () => {
  assert.deepEqual(appliedFilter({ open: false, query: "fix", path: "a.ts" }), { query: "", path: "" })
  assert.deepEqual(appliedFilter({ open: true, query: "  fix  ", path: "a.ts" }), { query: "fix", path: "a.ts" })
  assert.equal(isFiltered(appliedFilter(closedFilter)), false)
  assert.equal(isFiltered(appliedFilter({ open: true, query: "   ", path: "" })), false)
})

test("file history opens the row on the path alone", () => {
  assert.deepEqual(fileHistory("src/app.ts"), { open: true, query: "", path: "src/app.ts" })
  assert.deepEqual(appliedFilter(fileHistory("src/app.ts")), { query: "", path: "src/app.ts" })
})

test("responses match the filter they were read with", () => {
  assert.equal(sameHistoryFilter(page({ query: "fix" }), { query: "fix", path: "" }), true)
  assert.equal(sameHistoryFilter(page({ query: "fix" }), { query: "fi", path: "" }), false)
  assert.equal(sameHistoryFilter(page({ path: "a.ts" }), { query: "", path: "" }), false)
})

test("empty lists explain the filter, and how far a capped search went", () => {
  assert.equal(emptyHistoryMessage(page({ query: "fix" })), "No commits match.")
  assert.equal(emptyHistoryMessage(page({ path: "a.ts", more: true, next: 10000 })), "No commits match in the 10,000 most recent commits.")
  assert.equal(emptyHistoryMessage(page()), "No commits ahead of main.")
  assert.equal(emptyHistoryMessage(page({ base: "" })), "No base branch found to compare with.")
  assert.equal(emptyHistoryMessage(page({ range: "all" })), "No commits yet.")
})

test("the more row searches further back while a filtered list is empty", () => {
  assert.equal(moreLabel(page({ path: "a.ts", more: true })), "Search older commits")
  assert.equal(moreLabel(page({ path: "a.ts", more: true, commits: [{
    hash: "b".repeat(40), parents: [], subject: "s", body: "", author: { name: "n", email: "e" }, authorTime: "2026-10-21T14:02:00+11:00",
  }] })), "Load more")
  assert.equal(moreLabel(page({ more: true })), "Load more")
})

test("filtered reads are announced with their match count", () => {
  const commit = { hash: "b".repeat(40), parents: [], subject: "s", body: "", author: { name: "n", email: "e" }, authorTime: "2026-10-21T14:02:00+11:00" }
  assert.equal(filterAnnouncement(page({ commits: [commit] })), "")
  assert.equal(filterAnnouncement(page({ query: "s", commits: [commit] })), "1 commit matches.")
  assert.equal(filterAnnouncement(page({ query: "s", commits: [commit, commit], more: true })), "2+ commits match.")
  assert.equal(filterAnnouncement(page({ query: "s" })), "No commits match.")
})
