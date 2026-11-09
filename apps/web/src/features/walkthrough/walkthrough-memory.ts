import { isRecord } from "../../api/http.ts"

// Per-browser walkthrough memory (decisions 0047, 0113), under
// zero-walkthroughs: each project's newest walkthrough time the user has
// seen, for the activity badge; the last step opened in each walkthrough, to
// resume it; and each walkthrough's progress (the steps read and whether it
// was finished) at the version read. Pure functions return new values; at
// most 50 projects and 100 walkthroughs each are kept, newest first.

const storageKey = "zero-walkthroughs"
const maxProjects = 50
const maxWalkthroughs = 100
// maxSteps matches the server's step limit (decision 0047).
const maxSteps = 200

// WalkthroughProgress is what the user read of one version of a
// walkthrough: updatedAt names the version, so republishing starts over.
export interface WalkthroughProgress {
  updatedAt: string
  visited: number[]
  finished: boolean
}

export interface WalkthroughMemory {
  // seen is the newest updatedAt seen per project.
  seen: Record<string, string>
  // steps is the last step index per project and walkthrough.
  steps: Record<string, Record<string, number>>
  // progress is per project and walkthrough.
  progress: Record<string, Record<string, WalkthroughProgress>>
}

export const emptyWalkthroughMemory: WalkthroughMemory = { seen: {}, steps: {}, progress: {} }

function entries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : []
}

function isStepIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < maxSteps
}

function parseProgress(value: unknown): WalkthroughProgress | null {
  if (!isRecord(value) || typeof value.updatedAt !== "string") return null
  const visited = Array.isArray(value.visited) ? [...new Set(value.visited.filter(isStepIndex))].sort((a, b) => a - b) : []
  return { updatedAt: value.updatedAt, visited, finished: value.finished === true }
}

export function parseWalkthroughMemory(value: unknown): WalkthroughMemory {
  if (!isRecord(value)) return emptyWalkthroughMemory
  const seen: Record<string, string> = {}
  for (const [project, time] of entries(value.seen).slice(0, maxProjects)) {
    if (typeof time === "string") seen[project] = time
  }
  const steps: Record<string, Record<string, number>> = {}
  for (const [project, ids] of entries(value.steps).slice(0, maxProjects)) {
    const kept: Record<string, number> = {}
    for (const [id, step] of entries(ids).slice(0, maxWalkthroughs)) {
      if (typeof step === "number" && Number.isInteger(step) && step >= 0) kept[id] = step
    }
    steps[project] = kept
  }
  const progress: Record<string, Record<string, WalkthroughProgress>> = {}
  for (const [project, ids] of entries(value.progress).slice(0, maxProjects)) {
    const kept: Record<string, WalkthroughProgress> = {}
    for (const [id, entry] of entries(ids).slice(0, maxWalkthroughs)) {
      const parsed = parseProgress(entry)
      if (parsed) kept[id] = parsed
    }
    progress[project] = kept
  }
  return { seen, steps, progress }
}

// progressOf is a walkthrough's progress at version updatedAt; progress of
// another version counts for nothing.
export function progressOf(memory: WalkthroughMemory, project: string, id: string, updatedAt: string): WalkthroughProgress {
  const entry = memory.progress[project]?.[id]
  return entry && entry.updatedAt === updatedAt ? entry : { updatedAt, visited: [], finished: false }
}

function withProgress(memory: WalkthroughMemory, project: string, id: string, next: WalkthroughProgress): WalkthroughMemory {
  const ids = memory.progress[project] ?? {}
  return { ...memory, progress: withFirst(memory.progress, project, withFirst(ids, id, next, maxWalkthroughs), maxProjects) }
}

// rememberOpened records that version updatedAt was opened, so the list no
// longer marks it new.
export function rememberOpened(memory: WalkthroughMemory, project: string, id: string, updatedAt: string): WalkthroughMemory {
  if (memory.progress[project]?.[id]?.updatedAt === updatedAt) return memory
  return withProgress(memory, project, id, progressOf(memory, project, id, updatedAt))
}

// rememberVisited adds step to version updatedAt's read steps.
export function rememberVisited(memory: WalkthroughMemory, project: string, id: string, updatedAt: string, step: number): WalkthroughMemory {
  if (!isStepIndex(step)) return memory
  const current = progressOf(memory, project, id, updatedAt)
  if (memory.progress[project]?.[id] === current && current.visited.includes(step)) return memory
  const visited = [...new Set([...current.visited, step])].sort((a, b) => a - b)
  return withProgress(memory, project, id, { ...current, visited })
}

// rememberFinished marks version updatedAt finished.
export function rememberFinished(memory: WalkthroughMemory, project: string, id: string, updatedAt: string): WalkthroughMemory {
  const current = progressOf(memory, project, id, updatedAt)
  if (memory.progress[project]?.[id] === current && current.finished) return memory
  return withProgress(memory, project, id, { ...current, finished: true })
}

// isNew is whether the user has not opened this version of a walkthrough.
export function isNew(memory: WalkthroughMemory, project: string, id: string, updatedAt: string): boolean {
  return memory.progress[project]?.[id]?.updatedAt !== updatedAt
}

// withFirst puts key first in record, dropping entries past max.
function withFirst<T>(record: Record<string, T>, key: string, value: T, max: number): Record<string, T> {
  const { [key]: _previous, ...rest } = record
  return Object.fromEntries([[key, value], ...Object.entries(rest).slice(0, max - 1)])
}

export function rememberSeen(memory: WalkthroughMemory, project: string, updatedAt: string): WalkthroughMemory {
  if (memory.seen[project] === updatedAt) return memory
  return { ...memory, seen: withFirst(memory.seen, project, updatedAt, maxProjects) }
}

export function rememberStep(memory: WalkthroughMemory, project: string, id: string, step: number): WalkthroughMemory {
  const ids = memory.steps[project] ?? {}
  if (ids[id] === step) return memory
  return { ...memory, steps: withFirst(memory.steps, project, withFirst(ids, id, step, maxWalkthroughs), maxProjects) }
}

// unseenCount counts walkthroughs updated after the newest one seen; before
// any is seen, all are.
export function unseenCount(updated: readonly string[], seen: string | undefined): number {
  if (seen === undefined) return updated.length
  const since = Date.parse(seen)
  return updated.filter((time) => Date.parse(time) > since).length
}

export function readWalkthroughMemory(): WalkthroughMemory {
  try {
    return parseWalkthroughMemory(JSON.parse(window.localStorage.getItem(storageKey) ?? "null"))
  } catch {
    return emptyWalkthroughMemory
  }
}

export function writeWalkthroughMemory(memory: WalkthroughMemory) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(memory))
  } catch {
    // Walkthroughs still work when storage is unavailable.
  }
}
