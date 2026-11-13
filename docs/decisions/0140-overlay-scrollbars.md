# 0140: Overlay scrollbars

- Status: Accepted
- Date: 2026-11-13
- Supersedes: [0055](0055-scrollbars.md)'s reserved gutters, its hover-only thumb, and its "no JavaScript overlay scrollbars"; the review's gutter hairline of [0102](0102-sharp-slate-panes.md)

## Context

0055 styled native scrollbars and reserved a 10px gutter in every scroll area
whose content changes. In the desktop app the gutter read as a wide empty lane
beside the review, larger than the 6px thumb inside it. The thumb showed only
while the pointer was over its area: WebKit does not repaint a scrollbar when
its area's `:hover` changes, so it often stayed hidden, and keyboard and
kinetic scrolls never showed it. VS Code overlays its scrollbars and reserves
nothing.

## Decision

- For fine pointers, native scrollbars are hidden everywhere
  (`scrollbar-width: none`, `::-webkit-scrollbar { display: none }`), in the
  page and in Pierre's tree shadow roots, and no scroll area reserves a
  gutter. Wide diff code is the exception: it keeps Pierre's thin native bar
  with 0055's square thumb. Hiding it, or drawing it transparent, changed
  Pierre's row layout in WebKit, and a review's reveal then missed its line.
- One fixed layer (`components/ui/overlay-scrollbars.tsx`, mounted once in
  `App.tsx`) draws at most one vertical and one horizontal scrollbar: for the
  nearest scroll area on each axis under the pointer (found along the event's
  composed path, so Pierre's shadow roots count), or the area being scrolled
  when the pointer rests on none. An area that keeps a native bar
  (`scrollbar-width` other than `none`) gets no overlay.
- Each scrollbar is a 10px lane (`--scrollbar-size`) over its area's edge,
  kept to the visible edge of the area, holding a square thumb in
  translucent ink: 6px inset 2px (`--scrollbar-thumb-size`,
  `--scrollbar-inset`), the full lane under the pointer or while dragging;
  35% hovered, 45% dragged. A thumb is at least 20px long.
- A scrollbar shows while its area scrolls (and 800ms after), while the
  pointer is over the area or the lane, and while dragging; it then fades.
  Reduced motion drops the fade.
- Dragging the thumb scrolls proportionally; a press on the lane pages toward
  it. A press dispatches `zero-scrollbar-press` on the scroller, so a review's
  reveal pin ends as a press on a native bar does (0135).
- The layer is `aria-hidden`; keyboard scrolling is the browser's own. Inside
  an open modal dialog the layer moves into the dialog, above the inert page.
- `data-scrollbar="none"` opts an area out (the tab strip).
- Touch and other coarse primary pointers keep the platform's overlay
  scrollbars; the layer is not mounted.

## Consequences

- Content never shifts as overflow comes and goes, and no lane is spent.
- A visible lane covers the last 10px of its area's content, as VS Code's
  does; content there takes clicks again once the scrollbar fades.
- Only the hovered or scrolled area shows a thumb at a time per axis.
- Geometry is pure (`lib/scrollbar-geometry.ts`) and unit-tested; the layer
  reads layout only on scroll, pointer, and resize events, never per frame
  while idle.
