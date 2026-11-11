import type { CommitsResponse } from "@zero/contracts"

// Pure state for the Commits filter (decisions 0114, 0129): a query matched
// against message, author, and hash prefix, and a path whose history the
// list shows. The filter is transient: never persisted.

export interface CommitFilter {
  query: string
  // path is repository-relative; "" for none.
  path: string
}

// HistoryFilter is what a read sends: the trimmed query and the path.
export interface HistoryFilter {
  query: string
  path: string
}

export const emptyFilter: CommitFilter = { query: "", path: "" }
export const noHistoryFilter: HistoryFilter = { query: "", path: "" }

// fileHistory filters to a file's history, dropping any query.
export function fileHistory(path: string): CommitFilter {
  return { query: "", path }
}

// appliedFilter is the filter a read sends: the trimmed query and the path.
export function appliedFilter(filter: CommitFilter): HistoryFilter {
  return { query: filter.query.trim(), path: filter.path }
}

export function isFiltered(filter: HistoryFilter): boolean {
  return filter.query !== "" || filter.path !== ""
}

// sameHistoryFilter reports whether a response was read with filter.
export function sameHistoryFilter(response: Pick<CommitsResponse, "query" | "path">, filter: HistoryFilter): boolean {
  return response.query === filter.query && response.path === filter.path
}

// emptyHistoryMessage explains an empty list. A filtered page that stopped on
// the server's scan cap says how far it searched; Load more searches on.
export function emptyHistoryMessage(result: CommitsResponse): string {
  if (isFiltered(result)) {
    return result.more ? `No commits match in the ${result.next.toLocaleString()} most recent commits.` : "No commits match."
  }
  if (result.range === "all") return "No commits yet."
  return result.base ? `No commits ahead of ${result.base}.` : "No base branch found to compare with."
}

// moreLabel names the row that reads the next page: with nothing listed yet
// it searches further back.
export function moreLabel(result: CommitsResponse): string {
  return isFiltered(result) && result.commits.length === 0 ? "Search older commits" : "Load more"
}

// filterAnnouncement tells assistive technology what a filtered read found;
// "" while unfiltered.
export function filterAnnouncement(result: CommitsResponse): string {
  if (!isFiltered(result)) return ""
  const count = result.commits.length
  if (count === 0) return emptyHistoryMessage(result)
  return `${count.toLocaleString()}${result.more ? "+" : ""} ${count === 1 && !result.more ? "commit matches" : "commits match"}.`
}
