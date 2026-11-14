# 0141: Landing scenes and the feedback row

- Status: Accepted
- Date: 2026-11-13
- Revises: [0106](0106-feature-rows-landing.md)'s panes and row list; [0105](0105-walkthrough-landing.md)'s pane construction

## Context

0106's panes were whole app windows, padded and centered in each row's cell,
with a mono caption bar. Each read as a screenshot in a box: every pane the
same weight, every window shrunk whole, nothing moving. The hero showed a
walkthrough note, which the walkthroughs row showed again. Review feedback
(0120) shipped with no place on the landing.

## Decision

**Every row's visual is a Stageshow scene.** The Stageshow kit is vendored,
unchanged except as noted, in `apps/site/src/landing/kit/` (MIT, its
`LICENSE` beside it; the brand artwork and `BrandMark` removed).
`landing/scenes/` holds one scene per row, `app.tsx` (the faux zero app's
window, activity bar, tabs, file bands, and diff and source lines), and
`zero.css`, which maps the kit's tokens to the landing's slate tokens so
scenes follow the page's light and dark themes in JetBrains Mono.

- Scenes are framed, not boxed: the window is inset one gutter from the top
  and left of its cell and bleeds off the right and bottom, which the row's
  border crops. The stage sits on the cell's bottom edge. Each scene has a
  358px compact design for the stacked rows under 900px.
- The hero is the one animation: a reader selects a changed line, presses
  **C**, comments, the agent runs `zero feedback show` and
  `zero feedback reply --resolve` in its shell, and the reply lands in the
  thread, resolved. It loops; under reduced motion it shows the resolved
  thread as its poster. Every other scene is a still.
- Content stays invented. The caption bar is gone; each cell carries a small
  "synthetic demo" figcaption, and its figure is labelled as one.

**A feedback row.** After walkthroughs: agents explain, then the reader
answers. It shows the Feedback view across files and threads in their
statuses, not the hero's single round trip. Its tint is green.

**Host fixes for the kit.** The docs' `border-radius: 0 !important` rule
(0105's square corners) skips `.ss-stage` content, so windows, lights, and
the cursor keep their shapes. `kit/layers.css` orders the kit's `stageshow`
layer after Vocs' layers, so Vocs' base reset does not zero the kit's
padding. Scene modules are client components.

## Consequences

- The site depends on `lucide-react` (the app's own icon set, at the web
  app's version) and `@types/react-dom`.
- The vendored kit contains type assertions; the landing's own code does
  not. Updating the kit means copying it again and reapplying the two notes
  above.
- Scenes are tuned with the kit's `film.mjs` rehearsal gate at 1440 and 390
  CSS px; it is a design tool, not a check in `check:pr`.
