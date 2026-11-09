# 0113: Walkthrough reading flow

- Status: Accepted
- Date: 2026-11-09
- Extends: [0047](0047-walkthroughs.md), [0049](0049-copyable-agent-instructions.md)

## Context

Following a walkthrough (0047) left a trail of tabs, one per step. Progress
lived only in the session, the cover always offered to start over, and the
last step had no end: Next just turned off. A drifted step said its code
changed but not how. Diff steps opened among every changed file at full
strength, a note step sat on top of the whole cover, and present mode read
like the editor. A reader with a question had to describe the step to their
agent by hand.

Similar tools settled each of these: VS Code reuses one preview editor until
it is pinned, CodeTour and product tours mark steps read and end with a
finish, readers offer to resume where you left off, Code Hike and Stripe's
docs dim code around the lines in focus, GitHub shows an outdated comment's
original line, slides step on plain arrows, and PR chat sends the context
with the question.

## Decision

- A step's document or review opens as the preview tab: the next step's tab
  replaces it in place, and its name is italic. A tab that was already open
  is left as it is. Double-click or Keep Open (tab menu) pins it; closing the
  walkthrough pins it too. Preview is not remembered across reloads.
- In Source, lines outside the step's range dim until hovered or selected.
  A review opened at a step's file opens that file and starts every other
  file closed; any can still be opened.
- Each walkthrough keeps per-browser progress (`srcz-walkthroughs`
  `progress`): the steps read and whether it was finished, for the version
  read (`updatedAt`); republishing starts it over. The narration and the
  step bar draw a progress line, one mark per step up to 24, else a bar.
  The step list replaces a read step's number with a check; the list and
  heading say how many were read or that it was finished.
- A walkthrough not opened at its current version carries a New dot in the
  list. The activity badge keeps counting walkthroughs newer than the last
  ones seen.
- The cover offers Resume at step N, with Start over, when an unfinished
  walkthrough was left past its first step; a finished one offers Read
  again.
- On the last step Next becomes Finish (also Cmd/Ctrl+Right). Finishing
  marks the walkthrough finished, ends present mode, and leads the cover
  with a completion line: steps read, the next walkthrough not yet opened,
  and All walkthroughs.
- A drifted step's notice shows the line prefix the step expected and the
  line there now.
- A note step shows alone on the walkthrough's tab, with a link back to the
  overview, instead of above the cover.
- Present mode sets the narration larger and steps on plain Left and Right,
  Space and Shift+Space, and Page Up and Down, outside fields and controls.
  Code keeps the Font Size setting, which also sizes Pierre's diff rows.
  While the step bar shows (presenting, or a phone), the narration drops its
  own Previous and Next.
- The narration's Copy Step for Agent copies the walkthrough's title and id,
  the project, the step's number, title, and target, and a link to it,
  ending with “Question: ”.

## Consequences

- Progress is per browser: other browsers and desktop windows start fresh.
- Steps that open a tab already open leave the preview tab in place, so the
  next step may replace a tab further back in the strip.
- No server or contract change.
