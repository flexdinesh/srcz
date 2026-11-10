import type { SelectedLineRange, SelectionSide } from "@pierre/diffs"

import type { LineDiff } from "@zero/contracts"
import type { DiffStyle } from "./diff-options.ts"

// Hunks, blocks, and gaps come from the server's line diff (decision 0083),
// numbered from 1 on each side; these functions place selections and steps
// among them as the diff shows its rows. A step lands on a change: one run
// of deleted then added rows, without context (decision 0124).

// A DiffChange is one change block: its hunk and its rows on each side.
export interface DiffChange {
  hunk: number
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

// diffChanges lists a file's change blocks in file order.
export function diffChanges(lineDiff: LineDiff): DiffChange[] {
  return lineDiff.hunks.flatMap((hunk, index) => hunk.blocks
    .filter((block) => block.kind === "change")
    .map((block) => ({ hunk: index, oldStart: block.oldStart, oldCount: block.oldCount, newStart: block.newStart, newCount: block.newCount })))
}

// changeSelection selects a change's rows as shown, first to last. Additions
// address the new side; an end on deletions only addresses the old side, so
// the range can cross sides.
export function changeSelection(lineDiff: LineDiff, index: number, style: DiffStyle): SelectedLineRange | null {
  const change = diffChanges(lineDiff)[index]
  if (!change) return null
  // Unified lists a change's deletions first; Split pairs them with additions.
  const startsOld = style === "unified" ? change.oldCount > 0 : change.newCount === 0
  const endsOld = style === "unified" ? change.newCount === 0 : change.oldCount > change.newCount
  const side: SelectionSide = startsOld ? "deletions" : "additions"
  const endSide: SelectionSide = endsOld ? "deletions" : "additions"
  return {
    start: startsOld ? change.oldStart : change.newStart, side,
    end: endsOld ? change.oldStart + change.oldCount - 1 : change.newStart + change.newCount - 1, endSide,
  }
}

// A ChangeCursor places a position among changes: inside one, or before one
// (index equals the change count past the last).
export type ChangeCursor = { kind: "at" | "before"; index: number }

// changeCursor places a line of either side among the changes. A change with
// no rows on that side sits before its start line there.
export function changeCursor(lineDiff: LineDiff, side: SelectionSide, line: number): ChangeCursor {
  const changes = diffChanges(lineDiff)
  for (const [index, change] of changes.entries()) {
    const start = side === "deletions" ? change.oldStart : change.newStart
    const count = side === "deletions" ? change.oldCount : change.newCount
    if (line < start) return { kind: "before", index }
    if (line < start + count) return { kind: "at", index }
  }
  return { kind: "before", index: changes.length }
}

// A ChangePosition is a change's place among its file's changes, from 1.
export interface ChangePosition {
  index: number
  count: number
}

// changePosition finds the change a selection covers exactly, as a step
// selects it; any other selection has none.
export function changePosition(lineDiff: LineDiff, selection: SelectedLineRange, style: DiffStyle): ChangePosition | null {
  const count = diffChanges(lineDiff).length
  const side = selection.side ?? "additions"
  const endSide = selection.endSide ?? side
  for (let index = 0; index < count; index++) {
    const change = changeSelection(lineDiff, index, style)
    if (change && change.start === selection.start && change.end === selection.end && change.side === side && change.endSide === endSide) {
      return { index: index + 1, count }
    }
  }
  return null
}

// A CollapsedLine is a line inside an unchanged gap: the gap's hunk index
// (the hunk count past the last hunk, as Pierre expands it), its length, and
// the line's number on the new side.
export interface CollapsedLine {
  hunkIndex: number
  lines: number
  newLine: number
}

// gapForLine finds the unchanged gap that holds a line of either side.
export function gapForLine(lineDiff: LineDiff, side: SelectionSide, line: number): CollapsedLine | null {
  for (const gap of lineDiff.gaps) {
    const start = side === "deletions" ? gap.oldStart : gap.newStart
    if (line >= start && line < start + gap.lines) return { hunkIndex: gap.hunk, lines: gap.lines, newLine: gap.newStart + line - start }
  }
  return null
}

// hunkInFile steps to the next or previous of count changes without
// wrapping, null past the file's ends; a review then moves on to another
// file.
export function hunkInFile(count: number, cursor: ChangeCursor, direction: 1 | -1): number | null {
  const next = direction === 1
    ? cursor.kind === "at" ? cursor.index + 1 : cursor.index
    : cursor.index - 1
  return next >= 0 && next < count ? next : null
}

// fileOrder lists the files a review step visits after from, in direction,
// wrapping past the ends and ending on from itself (decision 0035).
export function fileOrder(count: number, from: number, direction: 1 | -1): number[] {
  if (count <= 0) return []
  const start = from >= 0 && from < count ? from : direction === 1 ? count - 1 : 0
  return Array.from({ length: count }, (_, step) => (((start + direction * (step + 1)) % count) + count) % count)
}
