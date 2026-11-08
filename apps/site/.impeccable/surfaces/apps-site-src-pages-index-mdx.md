---
version: 1
slug: "apps-site-src-pages-index-mdx"
primary_target: "apps/site/src/pages/index.mdx"
related_targets: ["apps/site/src/landing/Landing.tsx","apps/site/src/pages/_root.css"]
---

# Landing (`/`)

Scope: marketing landing at `/` plus Vocs docs chrome. Mode: Persuade (landing), Read (docs chrome).

Audience: developers who run coding agents and need to read what the agents changed: files, diffs, commits, branches, walkthroughs, often on a remote box. Action: copy the install command or open Get started.

Proof: HTML-built app panes in the slate world, synthetic demo content labeled "synthetic demo"; facts only, no benchmarks.

## Direction contract

THESIS: Each feature is shown as it really is: copy left, its own app pane right, one row per feature (decision 0106). The page is not a walkthrough or a sequence; walkthroughs are one feature among five. Refuses the split hero over a row of feature cards.

OWN-WORLD: Sharp slate panes from DESIGN.md: square corners, 1px hairlines, mono chrome labels, compact app density (44px nav, 30px bands, 22px rows). Framed column with diagonal-hatched gutters and blue-tinted rails; per-feature mild tints on each row's top edge (browse/walkthroughs blue, diffs green, remote coral, lean green); dot grid behind each pane.

STORY: A visitor learns this is the code viewer for the agentic era, sees an agent's change reviewed with an inline walkthrough note, scrolls past browse, diffs, walkthroughs, remote, and lean, and copies the install command.

FIRST VIEWPORT: Nav. Left 470px column: 44px headline "The code viewer for the agentic era.", lede, install tabs, Get started / Read the docs, centred vertically. Right: dot grid holding the app pane: agent/session-expiry diff with inline walkthrough note.

FORM: Feature rows, copy left and pane right on every row; previously walkthrough-led (seed:f3ce315b594d022a).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
