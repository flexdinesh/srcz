# 0107: Docs redesign

- Status: Accepted; header, toggle placement, and outline superseded by [0142](0142-sidebar-led-docs.md)
- Date: 2026-11-08
- Extends: [0105](0105-walkthrough-landing.md)'s framed docs chrome

## Context

The docs kept Vocs' own chrome under 0105's colors: a 56px top bar whose logo
cell and search box floated on different surfaces with no edge between bar and
page, GitHub and a theme toggle boxed in a sidebar footer, a hatched strip below
each page, a sliding progress bar beside the outline, and roomy code blocks
whose copy button scrolled away with long lines. Vocs also added an Ask AI bar
and a Copy page for AI button. None of it matched the landing's nav and footer
or the app's panes.

## Decision

**The docs header is the landing's nav.** One 44px bar
(`--vocs-spacing-topNav`) on one hairline across the logo cell and the content:
the wordmark scaled so its mark is 20px, a square mono search box, then GitHub
(a Vocs `topNav` link) and Vocs' light, dark, and system toggle as three square
cells. The `vocs@2.10.3` patch moves the toggle into the bar and removes the
sidebar footer; `socials` is gone.

**The docs end on the landing's footer band.** `src/pages/_slots.tsx` renders it
through Vocs' `Footer` slot: wordmark and MIT License, then GitHub and License,
on `--sz-chrome` under a hairline. The page has no bottom padding, so no hatch
shows below it. The slot is hidden on the landing's blank layout.

**Light mode is white.** `--sz-bg` is `#ffffff` in light; the sidebar takes
`--sz-side` (`#f6f7f9`, dark `#2b2f37`).

**The outline is text only.** A muted mono label over 22px mono rows, 16px per
level; no track and no indicator. Only the current section turns accent; Vocs
also marks its ancestors active, and they keep the row color.

**Code blocks are small app panes.** A 28px band names the block ("shell" for
shell fences, "code" otherwise, since Vocs does not pass the language) and holds
an uppercase Copy cell that reads Copied after a click. The band and Copy sit on
the non-scrolling container, so they stay put while long lines scroll. Code is
13px mono at 1.6.

**No AI features.** Every docs page sets `showAskAi: false`, which removes the
Ask AI bar, its Ctrl/Cmd+I shortcut, and both Copy page for AI buttons.

**No Releases links.** The landing nav and footer, and the docs, link GitHub
only for the repository.

## Consequences

- The patch edits Vocs' built `Layout.client.js`; a Vocs upgrade must carry it
  forward, and the `data-v-*` hooks can move (as 0105 noted).
- New docs pages must set `showAskAi: false`; Vocs has no global switch.
- The footer band spans the content column, not the full frame, because Vocs
  renders the slot inside `main`.
