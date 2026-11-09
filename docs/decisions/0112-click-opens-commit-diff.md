# 0112: Click opens a commit's diff

- Status: Accepted
- Date: 2026-11-09
- Supersedes: [0040](0040-source-control-panes-and-review-files-rail.md)'s deliberate commit diffs (the row's Diff action); [0042](0042-expandable-commit-rows.md)'s "Click still selects" and "expanding sends no request"

## Context

Opening a commit's diff took a click to select it and then a second target:
a 20px Diff action that appeared only on hover, focus, or the selection, or
Enter, or double-click. Selecting without opening had little use: the
selection drives nothing else. Expanded details showed a commit's message
and metadata but not what it changed. VS Code's Source Control graph opens a
commit's changes on click and lists its files when expanded.

## Decision

- Click selects a commit and opens its diff; focus stays in the list.
  Shift-click extends a contiguous range and opens the range's combined diff.
  On phones a tap opens the diff (closing the drawer, as before); a
  long-press then a tap opens the range's diff.
- Arrows, Home/End, and Space only select, so moving through the list never
  replaces the kept review (0048). Enter opens the selection's diff and moves
  focus to it; Escape narrows a range. Double-click no longer has its own
  action.
- The Diff action is removed. A file-diff glyph that is not a control
  replaces the age on hover and keyboard focus and stays on the selection
  (on a range, its newest commit only); it says a click opens the diff.
- Expanding a commit also lists its files: name, muted folder, and status
  letter, in review order, without line counts. It reads the commit's files
  through the same cached `/api/commit-files` request its review uses. The
  first 20 show; a trailing "N more files" row opens the review. Clicking a
  file opens the commit's review at that file.
- File rows stay pointer-only inside the details, which a listbox keeps out
  of the accessibility tree (0042); keyboard and screen-reader users open the
  review with Enter and use its Files rail.

## Consequences

- One request per opened or expanded commit, cached per commit for the
  session.
- Clicking through commits replaces the kept review each time; the
  keyboard does not.
- Line counts would need a compare-stats read per expanded commit; the
  review shows them.
