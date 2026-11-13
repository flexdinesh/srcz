import type { BlameCommitInfo, BlameKind, BlameRange, BlameResponse, PageData } from "@zero/contracts"
import { projectUrl } from "../../api/project-url.ts"
import { shortHash } from "../../lib/commit-hash.ts"
import { commitAge } from "../source-control/compare.ts"

// Pure model of Source's inline blame (decision 0139): who last changed the
// active line, read from one /api/blame response per shown text.

// LineBlame is one line's attribution. commit is null for uncommitted lines;
// originalLine is the line's number in that commit, 0 when uncommitted.
export interface LineBlame {
  line: number
  kind: BlameKind
  commit: BlameCommitInfo | null
  originalLine: number
}

// blameUrl reads a document's blame: the working tree, or the commit at.
export function blameUrl(project: string, path: string, at: string): string {
  const url = projectUrl("/api/blame", project, path)
  return at ? `${url}&${new URLSearchParams({ at }).toString()}` : url
}

// blameAvailable reports a page whose Source can show blame: a text file
// within the 4 MiB preview limit.
export function blameAvailable(page: PageData): boolean {
  return page.hasFile && page.selected !== "" && !page.binary && !page.tooLarge && !page.previewDisabled
}

// blameRange finds the range holding line, or null outside them.
export function blameRange(ranges: readonly BlameRange[], line: number): BlameRange | null {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const range = ranges[middle]
    if (!range) return null
    if (line < range.start) high = middle - 1
    else if (line >= range.start + range.count) low = middle + 1
    else return range
  }
  return null
}

// originalLine is line's number in the range's commit: ranges map their
// lines one to one. Uncommitted lines have none (0).
export function originalLine(range: BlameRange, line: number): number {
  return range.kind === "uncommitted" ? 0 : range.originalLine + (line - range.start)
}

// lineBlame attributes line of a shown text with lineCount lines. It is null
// when the response blames other text (its line count differs: the file moved
// on since), a folder outside a repository, or a line it does not cover.
export function lineBlame(response: BlameResponse, line: number, lineCount: number): LineBlame | null {
  if (!response.repository || response.lineCount !== lineCount) return null
  const range = blameRange(response.ranges, line)
  if (!range) return null
  if (range.kind === "uncommitted") return { line, kind: "uncommitted", commit: null, originalLine: 0 }
  const commit = response.commits[range.commit]
  return commit ? { line, kind: range.kind, commit, originalLine: originalLine(range, line) } : null
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// blameMonth reads an RFC 3339 time as its author's month: "Mar 2024".
export function blameMonth(time: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(time)
  const month = match ? months[Number(match[2]) - 1] : undefined
  return match && month ? `${month} ${match[1]}` : ""
}

// blameText is the inline label after the line: "Ada, 3 days ago · subject",
// "Uncommitted changes", or "Older than abc1234 · Mar 2024" where history was
// cut off.
export function blameText(blame: LineBlame, now: number): string {
  const commit = blame.commit
  if (!commit) return "Uncommitted changes"
  if (blame.kind === "boundary") {
    const month = blameMonth(commit.authorTime)
    return `Older than ${shortHash(commit.hash)}${month ? ` · ${month}` : ""}`
  }
  return `${commit.author.name}, ${commitAge(commit.authorTime, now).long} · ${commit.subject}`
}

// blameLabel names the inline blame for assistive technology.
export function blameLabel(blame: LineBlame, now: number): string {
  return `Blame for line ${blame.line}: ${blameText(blame, now)}`
}

// boundaryNote explains a boundary commit: the walk stopped before reaching
// the change that wrote the line.
export const boundaryNote = "Blame stopped here: history is older than this commit."
