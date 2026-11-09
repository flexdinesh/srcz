import assert from "node:assert/strict"
import test from "node:test"

import { appendedCommits, commitsUrl, refreshedCommits } from "./commit-pages.ts"
import type { Commit, CommitsResponse } from "@zero/contracts"

function commit(letter: string): Commit {
  return {
    hash: letter.repeat(40), parents: [], subject: letter, body: "",
    author: { name: "zero", email: "zero@example.com" }, authorTime: "2026-10-21T14:02:00+11:00",
  }
}

function response(head: string, letters: string, more: boolean, change: Partial<CommitsResponse> = {}): CommitsResponse {
  return {
    repository: true, branch: "feature", base: "main", range: "branch", query: "", path: "", head: head.repeat(40), ahead: 4,
    commits: [...letters].map(commit), more, next: letters.length, ...change,
  }
}

const hashes = (value: CommitsResponse) => value.commits.map((entry) => entry.subject).join("")

test("a refresh of unchanged history keeps the pages already loaded", () => {
  const loaded = response("a", "abcd", false)
  const kept = refreshedCommits(loaded, response("a", "ab", true))
  assert.equal(hashes(kept), "abcd")
  assert.equal(kept.more, false)
})

test("a refresh replaces the list when history, base, or range changed", () => {
  const loaded = response("a", "abcd", false)
  assert.equal(hashes(refreshedCommits(null, response("a", "ab", true))), "ab")
  assert.equal(hashes(refreshedCommits(loaded, response("e", "ea", true))), "ea")
  assert.equal(hashes(refreshedCommits(loaded, response("a", "ab", true, { ahead: 3 }))), "ab")
  assert.equal(hashes(refreshedCommits(loaded, response("a", "ab", true, { base: "origin/main" }))), "ab")
  assert.equal(hashes(refreshedCommits(loaded, response("a", "ab", true, { range: "all" }))), "ab")
  assert.equal(hashes(refreshedCommits(loaded, response("a", "ax", true))), "ax")
  assert.equal(hashes(refreshedCommits(loaded, response("a", "ab", true, { query: "fix" }))), "ab")
  assert.equal(hashes(refreshedCommits(loaded, response("a", "ab", true, { path: "src/a.ts" }))), "ab")
})

test("a kept refresh keeps the scan cursor of the pages loaded", () => {
  const loaded = response("a", "abcd", true, { query: "fix", next: 9000 })
  const kept = refreshedCommits(loaded, response("a", "ab", true, { query: "fix", next: 120 }))
  assert.equal(hashes(kept), "abcd")
  assert.equal(kept.next, 9000)
})

test("next pages append to the same walk only", () => {
  const loaded = response("a", "ab", true)
  const next = appendedCommits(loaded, response("a", "bcd", false))
  assert.equal(hashes(next), "abcd")
  assert.equal(next.more, false)
  assert.equal(appendedCommits(loaded, response("e", "cd", false)), loaded)
  assert.equal(appendedCommits(loaded, response("a", "cd", false, { path: "src/a.ts" })), loaded)
})

test("filtered pages continue from the scan cursor, even past an empty page", () => {
  const first = response("a", "", true, { path: "src/a.ts", next: 10000 })
  const second = appendedCommits(first, response("a", "c", true, { path: "src/a.ts", next: 20000 }))
  assert.equal(hashes(second), "c")
  assert.equal(second.next, 20000)
  assert.equal(second.more, true)
})

test("page URLs pin the head after the first page", () => {
  assert.equal(commitsUrl("/repo", "branch", "", 0), "/api/commits?project=%2Frepo&range=branch&limit=50")
  assert.equal(commitsUrl("/repo", "all", "a".repeat(40), 50), `/api/commits?project=%2Frepo&range=all&limit=50&head=${"a".repeat(40)}&skip=50`)
})

test("page URLs carry the query and path", () => {
  assert.equal(commitsUrl("/repo", "all", "", 0, "", { query: "fix crash", path: "src/a b.ts" }),
    "/api/commits?project=%2Frepo&range=all&limit=50&q=fix+crash&path=src%2Fa+b.ts")
  assert.equal(commitsUrl("/repo", "branch", "", 0, "main", { query: "", path: "" }), "/api/commits?project=%2Frepo&range=branch&limit=50&base=main")
})
