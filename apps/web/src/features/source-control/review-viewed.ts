import { isRecord } from "../../api/http.ts"

// Files marked Viewed in review tabs (decisions 0035, 0117), remembered in
// this browser under zero-review-viewed as project -> path -> blob. A mark
// keeps the blob it was made at: it counts while the file's blob matches,
// and once the blob changes the file reads as changed since viewed until it
// is marked again. Pure except for readViewed/writeViewed, which never throw.

export const VIEWED_STORAGE_KEY = "zero-review-viewed"

const maxProjects = 50
const maxFiles = 2_000

export type ViewedMarks = Readonly<Record<string, Readonly<Record<string, string>>>>

function isBlob(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value)
}

export function parseViewed(value: unknown): ViewedMarks {
  if (!isRecord(value)) return {}
  const marks: Record<string, Record<string, string>> = {}
  for (const [project, files] of Object.entries(value)) {
    if (project === "__proto__" || !isRecord(files)) continue
    const kept: Record<string, string> = {}
    for (const [path, blob] of Object.entries(files)) {
      if (path !== "__proto__" && isBlob(blob)) kept[path] = blob
    }
    marks[project] = kept
  }
  return marks
}

// ViewedState is a file's review progress: never marked (or its blob is not
// known yet), viewed at its current blob, or marked at an older blob.
export type ViewedState = "unviewed" | "viewed" | "changed"

// viewedState reads a file's mark against its current blob.
export function viewedState(marks: ViewedMarks, project: string, path: string, blob: string): ViewedState {
  if (!blob || !Object.hasOwn(marks, project)) return "unviewed"
  const files = marks[project]
  if (files === undefined || !Object.hasOwn(files, path)) return "unviewed"
  return files[path] === blob ? "viewed" : "changed"
}

// isViewed reports a file viewed at blob; an unknown blob is never viewed.
export function isViewed(marks: ViewedMarks, project: string, path: string, blob: string): boolean {
  return viewedState(marks, project, path, blob) === "viewed"
}

// withViewed marks or unmarks a file. The most recent project and file go
// last, so the oldest drop first past the caps.
export function withViewed(marks: ViewedMarks, project: string, path: string, blob: string, viewed: boolean): ViewedMarks {
  const { [project]: files = {}, ...others } = marks
  const { [path]: _previous, ...rest } = files
  const kept = Object.entries(rest).slice(-(maxFiles - 1))
  const nextFiles = Object.fromEntries(viewed && blob ? [...kept, [path, blob]] : kept)
  return { ...Object.fromEntries(Object.entries(others).slice(-(maxProjects - 1))), [project]: nextFiles }
}

export function readViewed(): ViewedMarks {
  try {
    const raw = window.localStorage.getItem(VIEWED_STORAGE_KEY)
    return raw ? parseViewed(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export function writeViewed(marks: ViewedMarks) {
  try {
    window.localStorage.setItem(VIEWED_STORAGE_KEY, JSON.stringify(marks))
  } catch {
    // Storage is a convenience; marks still apply for this session.
  }
}
