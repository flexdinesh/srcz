import type { CommitsResponse } from "@srcz/contracts"

import { noHistoryFilter, type HistoryFilter } from "./commit-filter.ts"

// Pure paging for the Commits list: pages pin the head they started from, and
// a refresh that finds the same history keeps the pages already loaded.

export const commitPageSize = 50

// refreshedCommits merges a refreshed first page into the loaded list. The
// same range, filter, head, base, and ahead count with the same first commits
// mean the history is unchanged, so later pages stay; otherwise the first
// page replaces the list.
export function refreshedCommits(previous: CommitsResponse | null, first: CommitsResponse): CommitsResponse {
  if (!previous || previous.range !== first.range || previous.query !== first.query || previous.path !== first.path
    || previous.head !== first.head || previous.base !== first.base
    || previous.ahead !== first.ahead || previous.commits.length < first.commits.length
    || first.commits.some((commit, index) => previous.commits[index]?.hash !== commit.hash)) {
    return first
  }
  return { ...first, commits: previous.commits, more: previous.more, next: previous.next }
}

// appendedCommits adds the next page of the same walk and filter, skipping
// any commit already listed.
export function appendedCommits(previous: CommitsResponse, page: CommitsResponse): CommitsResponse {
  if (page.head !== previous.head || page.range !== previous.range || page.query !== previous.query || page.path !== previous.path) {
    return previous
  }
  const seen = new Set(previous.commits.map((commit) => commit.hash))
  return {
    ...previous,
    commits: [...previous.commits, ...page.commits.filter((commit) => !seen.has(commit.hash))],
    more: page.more,
    next: page.next,
  }
}

// commitsUrl reads a page from skip, the previous page's next; base is the
// chosen base branch, "" for the default.
export function commitsUrl(
  project: string, range: CommitsResponse["range"], head: string, skip: number, base = "", filter: HistoryFilter = noHistoryFilter,
): string {
  const params = new URLSearchParams({ project, range, limit: String(commitPageSize) })
  if (base) params.set("base", base)
  if (head) params.set("head", head)
  if (skip > 0) params.set("skip", String(skip))
  if (filter.query) params.set("q", filter.query)
  if (filter.path) params.set("path", filter.path)
  return `/api/commits?${params.toString()}`
}
