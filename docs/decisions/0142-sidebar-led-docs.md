# 0142: Sidebar-led docs

- Status: Accepted
- Date: 2026-11-14
- Supersedes: [0105](0105-walkthrough-landing.md)'s docs frame (hatch, rails,
  recessed sidebar); [0107](0107-docs-redesign.md)'s header bar, theme toggle
  placement, and text-only outline
- Keeps: 0107's code panes, footer band, white light mode, no AI features, and
  no Releases links

## Context

The docs sat in 0105's frame under 0107's header: a hatched surface past the
content column, rails beside it, and a grey sidebar whose fill stopped short of
its pane. The outline ran close to the content's edge. The page used three
surfaces where one would do, and the layout matched neither popular docs sites
(Linear, Mintlify, Stripe) nor the app's own sidebar.

## Decision

**One full-height sidebar holds the chrome** (1080px and wider, Vocs' `lg`). It
is 280px, anchored to the left edge: the logo row, the search box, the
navigation, then a footer row with GitHub (the `topNav` link) and the light,
dark, and system toggle. The `vocs@2.10.3` patch moves search, GitHub, and the
toggle into the sidebar.

**One background color.** No hatch, rails, or surface panel; hairlines separate
the sidebar, the content bar, and the outline's track.

**A content bar replaces the header.** Beside the logo row: a breadcrumb (the
page's sidebar group, then the page; Introduction shows the page alone), then
Vocs' edit link, "Edit this page on GitHub" (`editLink` in `vocs.config.ts`).
Under 1080px Vocs' top bar stays (logo, search, menu) and the breadcrumb moves
above the H1.

**Navigation reads like the app's sidebar.** Mono uppercase section labels over
14px sans rows. The current page is an accent wash (`--sz-accent-subtle` fill,
`--sz-accent-hover` text, weight 500) with no edge or ring; hover is a neutral
wash.

**The article and outline are centered beside the sidebar.** The article is
720px; the outline column (1376px and wider) has a 24px gutter and a 1px track
whose 2px accent bar follows the current section. Pages without an outline, the
docs home and the 404, take a wider column.

**Panes for tables and the pager.** Tables are flush with the prose under a
mono uppercase header band, like code panes. The pager is two panes, Previous
and Next, with mono labels and no Shift shortcuts. The edit link and Last
updated sit above it in mono.

**The docs home is cards.** A lede, a quick start (install script and
`zero .`), then Start (two) and Guides (six) as page cards on shared hairlines
(`src/docs/DocCards.tsx`, local because Vocs' `Cards` markup could not take the
layout), then the features list.

**The search dialog and phone drawer follow.** Search is a 640px pane under a
light scrim with a 52px query row, a mono trail per result, the selected result
in the accent wash, and a hint footer. The phone drawer slides from the left
with 44px rows; Vocs keeps GitHub in its header row.

**A 404 inside the layout.** `src/pages/404.tsx` replaces Vocs' route: a mono
"404", the heading, a lede, Docs home and Getting started buttons, and the
Ctrl/Cmd+K hint, with the sidebar and its search in reach. It shows no edit
link or pager.

## Consequences

- The patch grows: it adds the breadcrumb and moves search, GitHub, and the
  toggle. A Vocs upgrade must carry it, and the `data-v-*` hooks can move.
- The search dialog has no `data-v-*` hooks; its CSS keys on the listbox
  (`#search-results`) and Base UI's roles. Vocs does not group results, so the
  dialog shows no group labels.
- Breakpoints follow Vocs: 1080px for the sidebar, 1376px for the outline.
