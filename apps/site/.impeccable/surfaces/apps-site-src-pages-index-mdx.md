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

THESIS: The page is itself an agent walkthrough of Source Zero: six steps, narration left, the app pane right showing the lines each step talks about. Refuses the split hero over a row of feature cards.

OWN-WORLD: Sharp slate panes from DESIGN.md: square corners, 1px hairlines, mono chrome labels, compact app density (44px nav, 36px step bar, 30px bands, 22px rows). Framed column with diagonal-hatched gutters and blue-tinted rails; per-step mild tints (browse/walkthrough blue, diffs green, remote coral, lean green); dot grid stage behind the app pane.

STORY: A visitor learns this is the code viewer for the agentic era, sees an agent's change reviewed with an inline walkthrough note, steps through browse, diffs, walkthroughs, remote, lean, and copies the install command.

FIRST VIEWPORT: Nav; sticky step bar (step 1 of 6, tinted pips, Prev/Next). Left 470px column: step label, 44px headline "The code viewer for the agentic era.", lede, install tabs, Get started / Read the docs, step list anchored at the column bottom. Right: dot-grid stage holding a sticky app pane: agent/session-expiry diff with inline step note.

FORM: Walkthrough-led page, position 6 on the ordered list, seed:f3ce315b594d022a.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
