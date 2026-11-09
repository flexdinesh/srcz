import type { FileStats } from "@srcz/contracts"
import { countedLines, pureRename, type DiffStats } from "./diff-stats.ts"
import { statsLabel } from "./use-compare-stats.ts"

// DiffStatsText renders "+12 −3" with additions in success and deletions in
// destructive; a zero count keeps the surrounding ink.
export function DiffStatsText({ additions, deletions }: DiffStats) {
  return <>
    <span className="diff-stat" data-kind="added" data-zero={additions === 0 || undefined}>+{additions.toLocaleString()}</span>
    {" "}
    <span className="diff-stat" data-kind="deleted" data-zero={deletions === 0 || undefined}>−{deletions.toLocaleString()}</span>
  </>
}

// FileStatsText colors counted stats and keeps statsLabel's plain notes
// ("binary", "large") for the rest; a rename without line changes reads
// "renamed" in the surrounding muted ink (decision 0117).
export function FileStatsText({ stats, oldPath }: { stats: FileStats | undefined; oldPath?: string }) {
  if (pureRename(stats, oldPath)) return "renamed"
  const lines = countedLines(stats)
  return lines ? <DiffStatsText additions={lines.additions} deletions={lines.deletions} /> : statsLabel(stats)
}
