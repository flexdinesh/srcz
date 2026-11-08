# 0109: Neutral selection fill

- Status: Accepted
- Date: 2026-11-08
- Revises: [0033](0033-design-tokens-and-ui-primitives.md)'s selection roles,
  where selected rows and pressed toggles shared the accent tint

## Context

Selected rows, menus' highlighted items, and pressed toggles filled with
`accent-subtle` and set their text in `accent-hover`. Next to slate panes
(0102) the blue blocks were the loudest thing on screen, and the 1px accent
ring already marks the selection on its own.

## Decision

**Selection is an ink layer; the accent marks it.** `--color-selected` is
`text-primary` at 12% over whatever surface the row sits on, the same layer as
active and a step above hover (8%), and `--color-selected-text` is
`text-primary`. At 14% miasma's accent ring fell to 2.92:1 on raised surfaces.
At 12% two themes still fell under 3:1 on raised surfaces, so their accents
move up in lightness only, as decision 0036 allows for readability: nord
`#81a1c1` to `#88a9c9`, osaka-jade `#509475` to `#589c7d`. Solarized Light's
`text-primary` darkens from `#556b72` to `#495d64` so selected text holds
4.5:1 on the fill.
`--color-selected-border` and `--color-focus` stay `accent`. The rule is
semantic, so it holds in every theme, each with its own neutral.

The accent tint stays where it highlights content rather than state: text
selection, selected source line ranges (their numbers keep `accent-hover`), the
diff text selection, and the settings flash.

`themes.test.ts` checks every theme on `surface`, `surface-secondary`,
`surface-raised`, and `workspace-chrome`: the accent mark holds 3:1 on the
selection fill and selected text holds 4.5:1.

## Consequences

- Palette matches on the selected row are set in `text-primary` 600, as they
  were already set in `selected-text`.
- Hovering a selected row still shows the lighter hover layer, as before.
