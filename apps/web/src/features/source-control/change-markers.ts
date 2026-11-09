import type { ChangedFile, DiffResponse, LineDiff, PageData } from "@zero/contracts"
import { splitSourceLines } from "../../lib/line-selection.ts"

// Pure model of Source's change markers (decision 0115): where a working-tree
// file differs from HEAD, read from the server's line diff (decision 0083) and
// numbered on the new side from 1.

// A ChangeMarker is one change: added or modified lines start through end, or
// lines deleted between line after and the next (after 0 is before line 1).
export type ChangeMarker =
  | { kind: "added" | "modified"; start: number; end: number }
  | { kind: "deleted"; after: number; lines: number }

// changeMarkers maps each change block to a marker: only additions are added,
// only deletions deleted, both modified.
export function changeMarkers(lineDiff: LineDiff): ChangeMarker[] {
  const markers: ChangeMarker[] = []
  for (const hunk of lineDiff.hunks) {
    for (const block of hunk.blocks) {
      if (block.kind !== "change") continue
      if (block.newCount === 0) {
        if (block.oldCount > 0) markers.push({ kind: "deleted", after: block.newStart - 1, lines: block.oldCount })
        continue
      }
      markers.push({ kind: block.oldCount === 0 ? "added" : "modified", start: block.newStart, end: block.newStart + block.newCount - 1 })
    }
  }
  return markers
}

// The 0004 limit past which Source shows no highlighting, format, or diff.
export const markerSizeLimit = 4 << 20

// MarkerSource is where a page's markers come from: none, the whole file as
// added (an untracked or added file), or its working diff.
export type MarkerSource =
  | { kind: "none" }
  | { kind: "whole" }
  | { kind: "diff"; file: ChangedFile }

// markerSource decides whether a page shows markers. file is the page's entry
// in the Uncommitted change set; only working-tree text files within the
// limits show them.
export function markerSource(page: PageData, file: ChangedFile | undefined): MarkerSource {
  if (!page.hasFile || page.at || page.binary || page.tooLarge || page.fileSize > markerSizeLimit) return { kind: "none" }
  if (!file || file.path !== page.selected || file.status === "deleted") return { kind: "none" }
  if (file.status === "added" || file.status === "untracked") return { kind: "whole" }
  return { kind: "diff", file }
}

// wholeMarkers marks every line of a new file added; an empty file has none.
export function wholeMarkers(source: string): ChangeMarker[] {
  return source === "" ? [] : [{ kind: "added", start: 1, end: splitSourceLines(source).length }]
}

// diffMarkers maps a working diff read for source, or null when it cannot
// place them: its new side is not the text shown (the file moved on since),
// or it carries no line diff (a side is binary or too large).
export function diffMarkers(diff: DiffResponse, source: string): ChangeMarker[] | null {
  if (!diff.lineDiff || diff.modified?.content !== source) return null
  return changeMarkers(diff.lineDiff)
}

// markerLine is the new-side line a marker opens the review at: its first
// line, or the line before a deletion (line 1 at the file's start).
export function markerLine(marker: ChangeMarker): number {
  return marker.kind === "deleted" ? Math.max(marker.after, 1) : marker.start
}

function span(start: number, end: number): string {
  return start === end ? `line ${start}` : `lines ${start}–${end}`
}

// markerLabel names a marker in words, so status never rests on color.
export function markerLabel(marker: ChangeMarker): string {
  if (marker.kind !== "deleted") return `${marker.kind === "added" ? "Added" : "Modified"} ${span(marker.start, marker.end)}`
  const count = marker.lines === 1 ? "1 line" : `${marker.lines} lines`
  return marker.after === 0 ? `Deleted ${count} before line 1` : `Deleted ${count} after line ${marker.after}`
}

// A deletion's wedge sits on a row edge: between that row and the one above,
// inside the first row's top, or inside the last row's bottom.
export type WedgeEdge = "between" | "start" | "end"

// RowMarkers are the marks one Source row draws in its gutter: a bar segment
// (first is the range's first row, which names it) and a deletion wedge.
export interface RowMarkers {
  bar?: { marker: ChangeMarker; first: boolean }
  wedge?: { marker: ChangeMarker; edge: WedgeEdge }
}

// markerRows places markers on the rows of a lineCount-line source. A wedge
// sits at the top of the row after its deletion, which paints over the row
// above, so no row covers it. Marks past the last row are dropped.
export function markerRows(markers: readonly ChangeMarker[], lineCount: number): Map<number, RowMarkers> {
  const rows = new Map<number, RowMarkers>()
  const row = (line: number) => {
    const existing = rows.get(line)
    if (existing) return existing
    const created: RowMarkers = {}
    rows.set(line, created)
    return created
  }
  if (lineCount < 1) return rows
  for (const marker of markers) {
    if (marker.kind === "deleted") {
      if (marker.after >= lineCount) row(lineCount).wedge = { marker, edge: "end" }
      else row(marker.after + 1).wedge = { marker, edge: marker.after === 0 ? "start" : "between" }
      continue
    }
    const end = Math.min(marker.end, lineCount)
    for (let line = Math.max(marker.start, 1); line <= end; line++) row(line).bar = { marker, first: line === marker.start }
  }
  return rows
}
