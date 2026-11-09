import type { FileStats } from "@srcz/contracts"

export interface DiffStats {
  additions: number
  deletions: number
}

// countedLines is a file's line counts, or null unless they were counted.
export function countedLines(stats: FileStats | undefined): DiffStats | null {
  if (stats?.status !== "counted" || stats.additions === undefined || stats.deletions === undefined) return null
  return { additions: stats.additions, deletions: stats.deletions }
}

// diffStatsLabel reads like VS Code's footer: "+12 −3" (U+2212 minus).
export function diffStatsLabel(stats: DiffStats): string {
  return `+${stats.additions.toLocaleString()} −${stats.deletions.toLocaleString()}`
}

// pureRename is a renamed file whose lines did not change: its rows say
// "renamed" instead of "+0 −0" (decision 0117).
export function pureRename(stats: FileStats | undefined, oldPath: string | undefined): boolean {
  const lines = countedLines(stats)
  return Boolean(oldPath) && lines !== null && lines.additions === 0 && lines.deletions === 0
}
