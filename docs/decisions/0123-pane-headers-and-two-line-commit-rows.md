# 0123: Pane headers toggle across their width; two-line commit rows

- Status: Accepted
- Date: 2026-11-10
- Supersedes: the row-height pane header with trailing actions of [0040](0040-source-control-panes-and-review-files-rail.md)
- Extends: [0042](0042-expandable-commit-rows.md), [0112](0112-click-opens-commit-diff.md)

## Context

A Source Control pane opened and closed only from its title; the rest of the
header held its note and actions, so most of the band ignored clicks. Small
actions crowded the row-height header. Commit rows showed only a subject and a
short age, so author and hash needed a tooltip or the details.

## Decision

- A pane's header is one toggle across its full width (28px): title, then its
  note (count badge or muted summary). A click anywhere on it opens or closes
  the pane.
- An open pane's actions sit in their own row at the top of its body (at
  least 32px, 24px icon buttons, right-aligned, a hairline below). A closed
  pane shows no actions.
- Commit rows take two lines: the subject, then the author, relative age, and
  short hash, muted. The diff glyph shows at the row's end and no longer
  replaces the age.

## Consequences

- Commits and Branches actions (filter, range, base picker) are reachable only
  once the pane is open.
- Commit rows are about twice as tall; fewer fit without scrolling.
