# 0143: Mist, a white Zero Light

- Status: Accepted
- Date: 2026-11-14
- Supersedes: [0102](0102-sharp-slate-panes.md)'s Zero Light surface, chrome,
  and border values

## Context

0102 set Zero Light's panes on a `#fafafa` document, a `#eceef0` sidebar, and
`#e4e5e8` chrome bands under `#c9ccd1` hairlines. Light mode should read white:
the greys sat heavy around the content. Previews compared all-white panes, a
white document in whisper-slate chrome (Mist), white panes in a neutral frame,
and a warm alternate; Mist keeps the slate identity with every grey light.

## Decision

Zero Light (and Auto when it resolves light) takes Mist:

- `bg` and `surface` `#ffffff`: the document and review are white.
- `surface-secondary` `#f9fafb`: the sidebar and the review's file bands.
- `canvas` and `workspace-chrome` `#f4f5f7`: activity rail, tab strip, status
  bar. The white active tab is 1.09:1 against the strip, the step 0044 set.
- `surface-recessed` `#f4f5f7`: the sidebar tone is 1.04:1 on white, too faint
  for the active source line and code blocks, so recessed fills take the chrome
  tone. Dark keeps `surface-secondary`.
- `border` `#e3e5e9` and `border-strong` `#cbd0d6`: quieter hairlines.
- Text, accent, status, syntax, `field-border` (`#7a808a`, 3.8:1 on the
  sidebar), and Zero Dark are unchanged. Every surface is lighter, so the
  contrast floors in `themes.test.ts` hold with more room (muted text 5.38:1 on
  chrome).

The site follows: the landing's page, recessed, chrome, and border tokens take
the same values, its hatch and dot grid lighten to sit on white, and the docs'
side, chrome, recessed, and border tokens follow. Vocs' `gray13` (a light-only
fill) follows; `gray11` stays, since it is also Dark's text.

## Consequences

- Pane boundaries are quieter at 1.26:1; structure still comes from hairlines
  and the chrome bands.
- Current-item cues (active tab, chrome hover, selection) stay tint-level, as
  in 0044; text color and the accent ring carry the rest.
- Named light themes are unchanged.
