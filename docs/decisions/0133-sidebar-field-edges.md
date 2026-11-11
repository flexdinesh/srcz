# 0133: Sidebar field edges

- Status: Accepted
- Date: 2026-11-12
- Amends: [0045](0045-selection-marks-and-field-edges.md) (the 3:1 field edge
  no longer applies to sidebar query fields)

## Context

0045 gave every text field a `--color-field-border` edge that holds 3:1
against the field and its ground. In the sidebar the query fields (Explorer
filter and file search, the Search view's fields, the Commits filter) sit on
panes drawn with `border` hairlines, and their edge read as the darkest line in
the view.

## Decision

- `.ui-field` reads its rest edge from `--field-border`, falling back to
  `--color-field-border`. A context sets it, as `--icon-button-min` is set.
- `.sidebar` sets `--field-border: var(--color-border-strong)`, desktop and the
  mobile drawer alike. Focus (accent border plus a 1px ring) and invalid
  (destructive) are unchanged.
- Fields elsewhere (Settings, pickers, dialogs, the review Files rail) keep the
  3:1 edge.

## Consequences

- A sidebar field's edge at rest is below 3:1 (WCAG 1.4.11). Its `surface`
  fill against the chrome band, its icon and placeholder, and the focus ring
  identify it.
