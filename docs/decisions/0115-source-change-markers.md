# 0115: Change markers in Source

- Status: Accepted
- Date: 2026-11-09
- Extends: [0024](0024-source-control-view-and-working-tree-diffs.md)'s
  working-tree diffs, [0083](0083-server-structured-diffs.md)'s `lineDiff`,
  [0050](0050-live-updates.md)'s rereads

## Context

Source showed a changed file exactly as an unchanged one. Seeing what an
edit touched meant opening the Uncommitted review and finding the file. VS
Code and Zed mark added, modified, and deleted lines beside the line numbers,
and a click there shows the change.

## Decision

- **Which files.** Only a working-tree Source document whose path is in the
  Uncommitted change set. Snapshots (`at=`), binary files, files over 4 MiB,
  deleted files, Format, Preview, and folders outside a repository show none.
  Untracked and added files show one added range without a request.
- **Data.** A modified or renamed file reads the existing `/api/diff` (the
  working compare) and maps its `lineDiff` change blocks to new-side ranges:
  only additions are added, only deletions deleted (between two new lines),
  both modified over their new lines. The mapping is the pure
  `features/source-control/change-markers.ts`. The diff applies only when its
  new side equals the text Source shows, so a mark never lands on text it
  wasn't read for. No server change.
- **Requests.** One per shown text of an opened changed document, cancelled
  when the document, its text, its change set entry, or git state changes.
  Until a reread's diff lands, the last marks for the same file stay.
- **Updates.** A live reread of the document (0050) changes its text, and a
  git change (HEAD may move) bumps a version: both reread the marks. A file
  that leaves the change set drops them at once.
- **Look.** The `ChangeMark` primitive fills the gutter's end inset: 3px bars,
  `success` for added and `accent` for modified, and a `destructive` wedge on
  the row edge after the deletion. Sizes are rem tokens, so they follow Font
  Size. Each mark has a title and an accessible name ("Added lines 3–5"); a
  range's later rows are hidden repeats. Only the wedge grows on hover: a bar
  widened row by row would break its range.
- **Click.** A mark opens the Uncommitted review at `#f=<path>&R<line>`, the
  change's first new-side line (the line before a deletion), through the
  existing open-review path, which reveals and selects it (0034).
- **Keyboard.** Marks are not Tab stops: a file can carry many, and the
  textbox keeps one stop. Keyboard users reach changes through the
  Uncommitted list and F7 in the review.

## Consequences

- An opened changed file costs one extra diff read, of both sides, at most
  8 MiB under the 0004 limits; unchanged files cost nothing.
- Between a file's edit and its reread the old marks show briefly.
- A modified range with more new lines than old marks them all modified, as
  VS Code does.

## Rejected

- **Diffing in the browser** against a HEAD blob: 0083 keeps diffs on the
  server.
- **A new marker endpoint**: `/api/diff` already carries the hunks; the extra
  bytes are the sides, bounded by the same limits.
- **One tall mark per range**: rows after its first paint over it, since each
  row's sticky gutter stacks above the one before.
