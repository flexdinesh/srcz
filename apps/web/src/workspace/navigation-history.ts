import { isRecord } from "../api/http.ts"
import { shortHash } from "../lib/commit-hash.ts"
import { fileName } from "./workspace-tabs.ts"

// The navigation log mirrors the browser's session history for Back,
// Forward, their lists, and Recent Locations (decision 0131). The browser
// knows only where it is (each entry's index); the log adds where Forward
// leads and what each entry showed. Pure helpers; the store applies them.

// HistoryEntry is one browser history entry the app visited.
export interface HistoryEntry {
  index: number
  // key is the router's entry key; a reloaded tab keeps it.
  key: string
  href: string
  project: string
  // label names the destination ("tsconfig.json"); title names it fully.
  label: string
  title: string
  // visited orders entries by when they were last shown.
  visited: number
}

export interface HistoryLog {
  // entries are sorted by index; an entry the app never saw is missing.
  entries: readonly HistoryEntry[]
  current: number
  // top is the last index Forward can reach.
  top: number
  clock: number
}

// HistoryMove is how the browser reached an entry: a new entry, the
// current one rewritten, or a move within the history.
export type HistoryMove = "push" | "replace" | "pop"

export interface HistoryVisit {
  index: number
  key: string
  href: string
}

export const emptyLog: HistoryLog = { entries: [], current: 0, top: 0, clock: 0 }

// placeOf is a visit's place: its route without the fragment, so a line
// anchor in the same document is the same place.
export function placeOf(href: string): string {
  const hash = href.indexOf("#")
  return hash < 0 ? href : href.slice(0, hash)
}

function searchOf(href: string): URLSearchParams {
  const query = placeOf(href).indexOf("?")
  return new URLSearchParams(query < 0 ? "" : placeOf(href).slice(query + 1))
}

// The router writes a string that would parse as JSON quoted; read it back.
function searchValue(search: URLSearchParams, name: string): string {
  const value = search.get(name) ?? ""
  if (!value.startsWith("\"")) return value
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "string" ? parsed : value
  } catch {
    return value
  }
}

// projectOf is the project a route opens.
export function projectOf(href: string): string {
  return searchValue(searchOf(href), "project")
}

// documentPathOf is the working-tree file a route opens, or "" for a
// snapshot or a route without a file.
export function documentPathOf(href: string): string {
  const search = searchOf(href)
  return searchValue(search, "at") ? "" : searchValue(search, "path")
}

// projectName names a project by its last path segment.
export function projectName(project: string): string {
  return project.split("/").filter(Boolean).at(-1) ?? project
}

// routeName names a route before the workspace has named it: after a
// reload, or for an entry the app has not shown since.
export function routeName(href: string): { label: string; title: string } {
  const search = searchOf(href)
  const path = searchValue(search, "path")
  const at = searchValue(search, "at")
  if (path) return at ? { label: `${fileName(path)} @ ${shortHash(at)}`, title: `${path} at ${at}` } : { label: fileName(path), title: path }
  if (search.has("review") || search.has("commit") || search.has("from")) return { label: "Review", title: "Review" }
  if (search.has("wt")) return { label: "Walkthrough", title: "Walkthrough" }
  if (search.has("welcome")) return { label: "Welcome", title: "Welcome" }
  const project = projectOf(href)
  return project ? { label: projectName(project), title: project } : { label: "Start", title: "Start" }
}

function entryAt(log: HistoryLog, index: number): HistoryEntry | undefined {
  return log.entries.find((entry) => entry.index === index)
}

function withEntry(entries: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...entries.filter((other) => other.index !== entry.index), entry].toSorted((a, b) => a.index - b.index)
}

// visit records the browser reaching an entry. A push drops what Forward
// led to, as the browser does. An entry rewritten in the same place (a line
// anchor) keeps its name; a move to a known entry keeps all of it.
export function visit(log: HistoryLog, move: HistoryMove, at: HistoryVisit): HistoryLog {
  const clock = log.clock + 1
  const known = entryAt(log, at.index)
  if (move === "pop" && known && known.key === at.key && known.href === at.href) {
    return { ...log, current: at.index, top: Math.max(log.top, at.index), clock, entries: withEntry(log.entries, { ...known, visited: clock }) }
  }
  const named = known && placeOf(known.href) === placeOf(at.href) ? { label: known.label, title: known.title } : routeName(at.href)
  const entry: HistoryEntry = { index: at.index, key: at.key, href: at.href, project: projectOf(at.href), ...named, visited: clock }
  if (move === "push") {
    return { entries: withEntry(log.entries.filter((other) => other.index < at.index), entry), current: at.index, top: at.index, clock }
  }
  return { entries: withEntry(log.entries, entry), current: at.index, top: Math.max(log.top, at.index), clock }
}

// name labels the current entry once the workspace has named what it shows.
export function name(log: HistoryLog, key: string, label: string, title: string): HistoryLog {
  const entry = entryAt(log, log.current)
  if (!entry || entry.key !== key || (entry.label === label && entry.title === title)) return log
  return { ...log, entries: withEntry(log.entries, { ...entry, label, title }) }
}

export function canGoBack(log: HistoryLog): boolean {
  return log.current > 0
}

export function canGoForward(log: HistoryLog): boolean {
  return log.current < log.top
}

// HistoryStep is an entry Back or Forward reaches, delta entries away.
export interface HistoryStep {
  delta: number
  entry: HistoryEntry | null
}

// steps lists the entries Back (-1) or Forward (1) reaches, nearest first.
export function steps(log: HistoryLog, direction: -1 | 1, limit = 12): HistoryStep[] {
  const last = direction < 0 ? 0 : log.top
  const count = Math.min(limit, Math.abs(last - log.current))
  return Array.from({ length: count }, (_, offset) => {
    const delta = direction * (offset + 1)
    return { delta, entry: entryAt(log, log.current + delta) ?? null }
  })
}

// recentLocations lists each place once, most recently shown first,
// leaving out the place on screen.
export function recentLocations(log: HistoryLog): HistoryEntry[] {
  const current = entryAt(log, log.current)
  const seen = new Set(current ? [placeOf(current.href)] : [])
  const recent: HistoryEntry[] = []
  for (const entry of log.entries.toSorted((a, b) => b.visited - a.visited)) {
    const place = placeOf(entry.href)
    if (seen.has(place)) continue
    seen.add(place)
    recent.push(entry)
  }
  return recent
}

// matchRecent keeps the places whose name, path, or project contains every
// whitespace-separated term, ignoring case; the order holds.
export function matchRecent(entries: readonly HistoryEntry[], query: string): HistoryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    const text = `${entry.label}\n${entry.title}\n${projectName(entry.project)}`.toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

// stepLabel describes an entry for a tooltip or list: its name, and its
// project when that is not the one on screen.
export function stepLabel(entry: HistoryEntry | null, project: string): string {
  if (!entry) return "an earlier location"
  return entry.project && entry.project !== project ? `${entry.label} in ${projectName(entry.project)}` : entry.label
}

function parseEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null
  const { index, key, href, project, label, title, visited } = value
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null
  if (typeof key !== "string" || typeof href !== "string" || typeof project !== "string") return null
  if (typeof label !== "string" || typeof title !== "string" || typeof visited !== "number") return null
  return { index, key, href, project, label, title, visited }
}

// parseLog reads a stored log, or the empty log when it is malformed.
export function parseLog(value: unknown): HistoryLog {
  if (!isRecord(value) || !Array.isArray(value.entries)) return emptyLog
  const { current, top, clock } = value
  if (typeof current !== "number" || typeof top !== "number" || typeof clock !== "number" || current > top) return emptyLog
  const entries: HistoryEntry[] = []
  for (const item of value.entries) {
    const entry = parseEntry(item)
    if (!entry || entry.index > top) return emptyLog
    entries.push(entry)
  }
  return { entries: entries.toSorted((a, b) => a.index - b.index), current, top, clock }
}

// resume continues a stored log at the browser's entry after a reload; a
// log from another history (its entry there differs) starts over.
export function resume(log: HistoryLog, at: HistoryVisit): HistoryLog {
  const known = entryAt(log, at.index)
  if (!known || known.key !== at.key || at.index > log.top) return visit(emptyLog, "replace", at)
  return visit(log, "pop", at)
}
