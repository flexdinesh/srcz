# 0137: Review selection is the chosen file

- Status: Accepted
- Date: 2026-11-12
- Supersedes: the file in view of [0135](0135-walkthrough-narration-panel-and-one-way-review-scroll.md) (its first bullet), and the scroll-following selection of [0035](0035-compare-list-and-review-tab.md) and [0040](0040-source-control-panes-and-review-files-rail.md)
- Amends: [0051](0051-branch-review-with-uncommitted.md), [0117](0117-review-order-viewed-flow-and-view-options.md)

## Context

A review tracked the file in view: on every scroll it found the section at
the pane's top and lifted it to the app, which selected it in the Files rail,
its phone sheet, and the Uncommitted list, and named it in the status bar.
The keys `]`, `[`, and `v`, and change steps started from it. In walkthroughs
and long reviews the rail kept changing under the reader, each change
re-rendered the workspace, and a reveal settling near the end of the review
had to be special-cased to stay "in view". Clicking a file to jump to its
diff already covers finding a file.

## Decision

- A review's current file is its `#f=` file: the last one asked for by a
  click in the Files rail or Uncommitted list, `]` or `[`, marking a file
  Viewed, a change step, a walkthrough step, or a link. Scrolling never
  changes it.
- The rail, its phone sheet, and the Uncommitted list select the current
  file; the status bar names the file holding selected lines, else the
  current file. With no `#f=` file (a review just opened), nothing is
  selected and the status bar names no file.
- `]` and `[` go to the file after or before the current one (the first or
  last without one); `v` toggles Viewed on the current file; a change step
  starts in the current file. Switching Committed and + Uncommitted keeps
  the current file.
- The reveal and its pin (0034, 0048, 0135) are unchanged: a deliberate
  request scrolls to the file or lines, and input or settling ends the pin.

## Consequences

- No scroll listener reports a file; scrolling a review re-renders nothing
  outside it.
- After a long scroll, `]`, `v`, and steps act from the chosen file, not the
  one on screen.
- No server or contract change.
