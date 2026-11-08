# 0106: Feature rows landing

- Status: Accepted
- Date: 2026-11-08
- Revises: [0105](0105-walkthrough-landing.md)'s landing structure

## Context

0105 made the landing a six-step walkthrough of the whole app: a sticky step
bar, numbered steps, a step list, and one sticky stage. Walkthroughs are a
feature agents use to explain their own changes, so presenting the product
itself as one misled visitors about what the feature is. The docs' inline code
and `pre` rules in `_root.css` also reached into the landing: the install
command lost its padding, and the remote terminal lost its coral border.

## Decision

**The landing is a column of feature rows.** The hero row, then browse, diffs,
walkthroughs, remote, and lean, in that order. Each row sets its copy on the
left (the 29.375rem column) beside its own app pane on the right, on the dot
grid. Every row has the same orientation.

- The hero keeps the headline, lede, install tabs, CTAs, and the review pane
  with its inline walkthrough note. The lean row keeps the second install and
  CTAs.
- Rows after the hero carry a 1px border with a 2px top edge in the feature's
  tint (0105's tints are unchanged). Each row is labelled by its name only
  (`browse`): no numbers, no step bar, no step list, no Prev/Next, no sticky
  stage, no scroll observer.
- Panes size to their content up to 34rem. Under 900px each row stacks its
  copy over its pane, as 0105's steps did.
- Rows are anchors by feature id (`#browse`); the `#step-*` anchors are gone.

**The docs' code rules skip the landing.** `_root.css` scopes its `pre` and
inline `code` rules with `:not(.landing pre)` and `:not(.landing code)`, so
the landing's own code, terminal, and install styles apply.

## Consequences

- The page no longer shows where a visitor is in a sequence. With five
  rows, there is nothing to jump between.
- `steps.ts`, `Walkthrough.tsx`, `StepBar.tsx`, and `use-active-step.ts` are
  replaced by `features.ts` and `Features.tsx`; `panes.tsx` exports
  `FeaturePane`.
