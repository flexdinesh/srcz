# 0105: Walkthrough landing and framed docs

- Status: Accepted; landing structure superseded by [0106](0106-feature-rows-landing.md); docs frame superseded by [0142](0142-sidebar-led-docs.md)
- Date: 2026-11-08
- Revises: [0074](0074-landing-page-and-cloudflare-pages.md)'s landing structure
- Extends: [0102](0102-sharp-slate-panes.md)'s sharp slate language to the docs chrome

## Context

The landing was a hero plus feature sections with animated SVGs. It described a
file browser and kept walkthroughs and remote serving below the fold. The product
is now a read-only viewer for reviewing what agents change, and the page did not
say so or show the app.

## Decision

**Positioning: the code viewer for the agentic era.** Browse files and review what
agents change: diffs, commits, branches, walkthroughs, remote serving, lean. The
README, the Vocs description, and the landing headline all say it.

**The landing is a walkthrough.** Six steps, the same form the product uses for
agent walkthroughs:

| Step | Tint |
| --- | --- |
| 01 overview: the code viewer for the agentic era (install, CTAs) | blue |
| 02 browse: any file | blue |
| 03 diffs: uncommitted, commits, branches, ranges | green |
| 04 walkthroughs: agents publish guided tours | blue |
| 05 remote: `srcz <path> --remote`, `srcz connect` | coral |
| 06 lean: facts, then install again | green |

- Narration on the left; on the right a sticky stage on a dot grid (1px dots,
  12px) shows the app pane for the active step. An `IntersectionObserver` picks the
  step; nothing hijacks scroll and no global keys are bound.
- A sticky step bar (36px) carries the step label, `n / 6`, pips that are links,
  the current title, and Prev/Next anchors. A step list sits at the bottom of the
  narration column.
- Panes are HTML and CSS built from the slate tokens, not screenshots or SVG
  animation, at app density (compact rows, 32px controls). Their content is
  invented and every pane is captioned "synthetic demo". Lean states facts, not
  benchmarks: no RAM figures.
- Under 900px the stage hides; each step stacks its narration over its own pane,
  side panels drop, and controls grow to 44px.
- Reduced motion swaps panes without the fade.

**Frame and tints.** The page sits in a framed column on blue-tinted rails over a
hatched background. Borders take a mild per-feature tint; coral stays with the
logo and remote. Square corners everywhere.

**Docs chrome takes the frame** (`apps/site/src/pages/_root.css`): hatched surface
outside the content column, rails beside it, the sidebar on the recessed surface
with mono section labels and the app's selection ring, a mono outline, blue-tinted
code frames, and callouts tinted per kind (blue, green for tip and success, coral
for warning and danger). The sidebar groups into Start and Guides.

## Consequences

- Vocs owns its layout, so the docs frame is CSS over `data-v-*` hooks; a Vocs
  upgrade can move them. The hatch shows only where Vocs leaves gutter: past the
  outline at 1376px and up, or beside content between 1024px and 1376px.
- Demo panes must be updated by hand when the app's look or CLI output changes.
- The removed animated SVGs (`apps/site/src/landing/svg/`) and `FeatureSection`
  are gone; 0074's install tabs and hosting (0103) are unchanged.
