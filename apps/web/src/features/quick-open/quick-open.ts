import type { HighlightRange } from "../search/search-engine.ts"
import { documentPathOf, recentLocations, type HistoryLog } from "../../workspace/navigation-history.ts"

// QuickOpenQuery is what the Quick Open field asks for: files by name,
// optionally at a line (`app.tsx:42`), a line in the current document
// (`:42`), or commands (`>`), as in VS Code.
export type QuickOpenQuery =
  | { kind: "files"; terms: string[]; line: number | null }
  | { kind: "line"; line: number }
  | { kind: "commands"; text: string }

const linePattern = /^(.*?):([1-9]\d*)(?::\d+)?\s*$/

export function parseQuickOpenQuery(input: string): QuickOpenQuery {
  if (input.startsWith(">")) return { kind: "commands", text: input.slice(1) }
  const match = linePattern.exec(input)
  const line = match ? Number(match[2]) : null
  const text = match ? match[1] ?? "" : input
  if (line !== null && !Number.isSafeInteger(line)) return { kind: "files", terms: terms(input), line: null }
  if (line !== null && text.trim() === "") return { kind: "line", line }
  return { kind: "files", terms: terms(text), line }
}

function terms(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean)
}

// FileIndex holds each path with its lowercase form, built once per tree so
// typing only scores.
export interface FileIndex {
  readonly entries: readonly IndexedFile[]
}

interface IndexedFile {
  path: string
  lower: string
  // nameStart is where the base name begins.
  nameStart: number
}

export function indexFiles(paths: readonly string[]): FileIndex {
  return {
    entries: paths.map((path) => ({ path, lower: lowerUnits(path), nameStart: path.lastIndexOf("/") + 1 })),
  }
}

// lowerUnits lowercases without changing length, so match positions index
// the original path.
function lowerUnits(text: string): string {
  const lower = text.toLowerCase()
  if (lower.length === text.length) return lower
  let result = ""
  for (const unit of text.split("")) {
    const folded = unit.toLowerCase()
    result += folded.length === 1 ? folded : unit
  }
  return result
}

export interface FileMatch {
  path: string
  score: number
  // name ranges index the base name; directory ranges the folder path
  // (the path before the last slash).
  name: readonly HighlightRange[]
  directory: readonly HighlightRange[]
}

export interface FileMatches {
  total: number
  matches: FileMatch[]
}

// Term tiers: a contiguous hit in the base name beats one elsewhere in the
// path, which beats in-order characters. Each tier's bonuses stay below the
// next tier's floor.
const nameTier = 2000
const pathTier = 1000
const scatteredCeiling = pathTier - 1

function boundary(path: string, index: number): boolean {
  if (index === 0) return true
  const previous = path.charAt(index - 1)
  const current = path.charAt(index)
  if ("/-_. ".includes(previous)) return true
  return current >= "A" && current <= "Z" && previous >= "a" && previous <= "z"
}

// termScore scores one term against a file, or returns null when it does not
// match. Given positions, it also records the matched characters; scoring
// every file allocates nothing.
function termScore(file: IndexedFile, term: string, positions?: number[]): number | null {
  const { path, lower, nameStart } = file
  const inName = lower.indexOf(term, nameStart)
  if (inName >= 0) {
    if (positions) for (let offset = 0; offset < term.length; offset++) positions.push(inName + offset)
    const prefix = inName === nameStart ? 300 : boundary(path, inName) ? 150 : 0
    return nameTier + prefix + term.length * 10
  }
  const inPath = lower.indexOf(term)
  if (inPath >= 0) {
    if (positions) for (let offset = 0; offset < term.length; offset++) positions.push(inPath + offset)
    return pathTier + (boundary(path, inPath) ? 75 : 0) + term.length * 5
  }
  // Place characters right to left so they land in the base name when they
  // can: word starts and runs score, and a run starting the base name reads
  // as its prefix.
  let score = 0
  let next = term.length - 1
  let placed = -2
  for (let index = lower.length - 1; index >= 0 && next >= 0; index--) {
    if (lower.charCodeAt(index) !== term.charCodeAt(next)) continue
    if (index >= nameStart) score += 4
    if (boundary(path, index)) score += 8
    if (placed === index + 1) score += 5
    positions?.push(index)
    placed = index
    next--
  }
  if (next >= 0) return null
  if (placed === nameStart) score += 12
  return Math.min(score, scatteredCeiling)
}

function ranges(positions: readonly number[], start: number, end: number): HighlightRange[] {
  const result: HighlightRange[] = []
  for (const position of positions) {
    if (position < start || position >= end) continue
    const last = result.at(-1)
    if (last && last.end === position - start) last.end++
    else result.push({ start: position - start, end: position - start + 1 })
  }
  return result
}

// matchFiles keeps paths matching every term and ranks them: base-name hits
// (prefix, then word start) first, then path hits, then in-order characters
// favoring word starts and runs. Shorter paths, then path order, break ties.
// Only the first limit matches are returned; total counts them all.
export function matchFiles(index: FileIndex, query: readonly string[], limit: number): FileMatches {
  if (query.length === 0) return { total: 0, matches: [] }
  const found: Candidate[] = []
  for (const file of index.entries) {
    let score = 0
    let matched = true
    for (const term of query) {
      const termMatch = termScore(file, term)
      if (termMatch === null) {
        matched = false
        break
      }
      score += termMatch
    }
    if (matched) found.push({ file, score })
  }
  found.sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length || (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0))
  // Highlights are built only for the rows shown.
  const matches = found.slice(0, limit).map(({ file, score }): FileMatch => {
    const positions: number[] = []
    for (const term of query) termScore(file, term, positions)
    const sorted = [...new Set(positions)].toSorted((a, b) => a - b)
    return {
      path: file.path,
      score,
      name: ranges(sorted, file.nameStart, file.path.length),
      directory: ranges(sorted, 0, Math.max(file.nameStart - 1, 0)),
    }
  })
  return { total: found.length, matches }
}

interface Candidate {
  file: IndexedFile
  score: number
}

// recentFiles lists this project's working-tree files this window showed,
// most recent first, each once, leaving out the current file and files no
// longer in the tree.
export function recentFiles(log: HistoryLog, project: string, files: ReadonlySet<string>, current: string): string[] {
  const seen = new Set([current])
  const recent: string[] = []
  for (const entry of recentLocations(log)) {
    if (entry.project !== project) continue
    const path = documentPathOf(entry.href)
    if (!path || seen.has(path) || !files.has(path)) continue
    seen.add(path)
    recent.push(path)
  }
  return recent
}

// splitPath separates a path's folder from its base name.
export function splitPath(path: string): { directory: string; name: string } {
  const slash = path.lastIndexOf("/")
  return slash < 0 ? { directory: "", name: path } : { directory: path.slice(0, slash), name: path.slice(slash + 1) }
}
