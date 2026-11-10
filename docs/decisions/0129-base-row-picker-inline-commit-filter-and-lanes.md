# 0129: Base row picker, inline commit filter, and stack lanes

- Status: Accepted
- Date: 2026-11-11
- Supersedes: the base picker's icon trigger in the Branches action row ([0035](0035-compare-list-and-review-tab.md), [0123](0123-pane-headers-and-two-line-commit-rows.md)); the Filter Commits toggle and Escape-hides-the-row of [0114](0114-commit-search-and-file-history.md)
- Extends: [0040](0040-source-control-panes-and-review-files-rail.md), [0042](0042-expandable-commit-rows.md), [0123](0123-pane-headers-and-two-line-commit-rows.md)

## Context

0123 gave each open pane an action row. Branches' row held only the base
picker's chevron, a 32px band for one button. Commits' row held a search
toggle and Branch/All, with the filter field in a second row below. Commits
and Branches were nearly all grey: subject, author, age, hash, `+N`, and HEAD
read alike, and nothing tied a commit to its branch in the stack.

## Decision

- Branches has no action row. The stack's base row (branch icon, base name,
  chevron, merge-base hash chip, “merge-base”) is a button named “Change base
  branch, <base>” that opens the base picker. It also follows the empty
  states (“Nothing ahead of main.”, “On main.”), and reads “Choose base
  branch” when no base was found. The header keeps its muted “base main”.
- Commits' action row is the filter: the field (“Filter commits”) fills it,
  Branch/All sits beside it at the field's height, and a path chip wraps
  under both. The field always shows; there is no toggle. Escape clears the
  query and path and, once the list rereads, moves focus to its row. Show
  File History and the palette command focus the field (not on phones).
- Colors come from roles every theme sets, through tokens in `tokens.css`:
  - The commit hash takes `--color-commit-hash` (`warning`, git log's amber),
    in rows, details, and the merge-base chip. Authors take secondary ink;
    ages stay muted.
  - Each stack layer has a lane: HEAD's layer is lane 0 (`accent`), the others
    cycle lanes 1 to 3 top to bottom (`syntax-function`, `syntax-keyword`,
    `success`). A layer's Branches row and its commits draw a 2px rail on their
    leading edge in that hue, running through expanded details; its branch
    icon and its branch chips take the hue too.
  - A commit's branch chips move onto its subject line.
  - `+N` takes `success`; HEAD is an accent chip.
- A commit's lane runs from its layer's tip for the layer's `ahead` commits
  in list order, stopping at the merge-base. Filtered lists show no lanes.

## Consequences

- The base picker is reachable only once the stack has loaded.
- The field costs a tab stop and a row whenever Commits is open.
- In merge-heavy history a side commit can take the lane of the layer it is
  listed under; names, chips, and position still identify layers.
- Lane hues follow each theme's syntax roles, so two lanes can look alike in
  some themes; color is never the only cue.
