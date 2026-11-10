# 0124: Change steps land on changes, answer anywhere in the review, and show their place

- Status: Accepted
- Date: 2026-11-10
- Supersedes: the hunk step unit and the pane-focus F7 binding of [0034](0034-diff-anchor-reveal-and-hunk-navigation.md), as [0035](0035-compare-list-and-review-tab.md) carried them to review tabs
- Extends: [0117](0117-review-order-viewed-flow-and-view-options.md) review keys

## Context

0034 stepped F7 through Pierre hunks, context included. A one-line change
selected nine rows, the selection tint covered the change's own colors, and
two edits a few lines apart were one stop. F7 listened on the document pane
only: on a fresh load, or after a click on the toolbar's Next change (whose
tooltip names F7), it did nothing. Mac laptops need Fn for F7, while the
other review keys (`]`, `[`, `v`, `c`) are plain letters. Nothing said where a
step had landed.

Surveyed tools: IDEs bind F7 (JetBrains, VS Code); Gerrit, magit, and Emacs
step changes with `n`/`p`, and Gerrit moves between files with `]`/`[`, as
zero does. Most stop on the change itself. Web pull request tools (GitHub,
GitLab, Graphite) do not step changes at all; few tools count them.

## Decision

- A step lands on a change: one run of deleted then added rows from the
  server's `lineDiff` blocks, without context. Its selection follows 0034's
  sides: Unified starts on a change's deletions, Split pairs them with its
  additions, and an end on deletions only addresses the old side. A stepped
  link is the change's rows: `#f=large.txt&R21`, or `#L10-R11` in Unified.
- `n` and `p` step to the next and previous change, outside text fields and
  without modifiers, beside F7 and Shift+F7. All four answer wherever the
  review keys do: focus in the review pane, its toolbar, its Files rail, or
  nowhere in particular. F7 types nothing, so it also steps from a text
  field there.
- Steps still cross files in review order and wrap past the review's ends
  (0035).
- When the selection is exactly a change, as a step selects it, the footer
  reads `Change 2 of 5` before the line label, counting the file's changes.
  Phones hide it with the line label. There is no review-wide count: it
  would read every file's diff.
- The pure change list, cursor, selection, and position live in
  `apps/web/src/features/source-control/diff-hunks.ts`; the keys in
  `review-keys.ts`.

## Consequences

- A file with many small edits takes more steps; each lands on rows that
  differ.
- Links written by earlier hunk steps still open; they select their range as
  any line link does.
- A gutter selection that matches a change exactly also shows its position.

## Rejected

- **An overview ruler or minimap of the review's changes**: the review is
  virtualized and rows not yet rendered have estimated positions (0034,
  0111), so marks would drift for the cost of reading every diff.
- **`j`/`k`**: they mean files in GitHub and GitLab and lines in Gerrit.
- **Confirming before crossing a file or wrapping** (JetBrains, Gerrit): a
  review is one continuous stream, as in magit, so steps cross freely.
