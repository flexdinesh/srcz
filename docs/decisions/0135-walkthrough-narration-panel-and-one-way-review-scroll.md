# 0135: Walkthrough narration panel and one-way review scroll

- Status: Accepted
- Date: 2026-11-10
- Supersedes: the inline narration zone of [0047](0047-walkthroughs.md) and the step bar of [0113](0113-walkthrough-reading-flow.md)
- Extends: [0034](0034-diff-anchor-reveal-and-hunk-navigation.md), [0048](0048-kept-review-tab.md), [0111](0111-review-pane-single-scroll-anchor.md)

## Context

A review reveals a file chosen in the Files rail or the Uncommitted list
and pins it while the diffs above it load and grow (0034, 0048). The pin
let go only on a wheel, pointer, key, or touch event. In the desktop app
(WebKitGTK) a scrollbar drag or a kinetic scroll sends none of those, so
the pin held: each diff that loaded pulled the pane back to the chosen file,
and the rail, which follows the file in view, highlighted it again. Reading
felt two-way: scrolling seemed to move the selection, and the selection the
scroll. Choosing the same file again after scrolling away did nothing,
because its fragment was already in the URL.

A walkthrough step's narration was a zone in the code under the step's
lines (0047). Scrolling took it out of view, it sat in a different place on
every step, and in Split diffs it filled one column. Readers lost the
explanation, or did not know where to look for it.

## Decision

- The file in view is an output: it highlights the rail, the Uncommitted
  list, and the status bar, and never opens a file, changes the URL, or
  scrolls. Trees open a file only from a click or key press in them, never
  from a selection that follows the scroll.
- Only an explicit request reveals and pins a file: a click in the Files
  rail or the Uncommitted list (each one, even for the file already in the
  URL), a step, a link, or the first open. A file list that reloads does
  not reveal again.
- Input (wheel, key, touch, a press on the scrollbar) still releases the
  pin at once. The pin also ends on its own once the reveal settles: the
  pinned file's diff shows and the content keeps its size for 300 ms, or
  3 s pass, whatever still loads. After that nothing pulls the pane back, so
  a scrollbar drag or kinetic scroll with no input event cannot snap it. A
  settled file stays the file in view while the pane is where it settled,
  even when too near the end to reach the top.
- Telling the reader's scrolls apart from the app's was tried and dropped:
  wrapping the pane's scroll methods to mark the app's scrolls (the pin,
  the diff virtualizer) still let unmarked browser scrolls (clamps as
  content shrinks, late events under load) release pins early.
- A step's narration is one panel under the tab strip, above the document,
  for every kind of step (Source, snapshot, diff, image, note): outside the
  document's scroll, so it stays in one place while the reader scrolls and
  steps. It holds the step count, title, Copy Step for Agent, Previous, Next
  (Finish on the last step), Close, the progress line, any drift notice, and
  the story. It caps at 40% of the viewport height and scrolls inside.
- Collapse folds the panel to its header and progress line, remembered per
  browser (`zero-narration`) across steps and walkthroughs. Until the reader
  chooses, phones start collapsed.
- The code keeps a slim marker under the step's lines, a pin and “Step N”,
  so the place stays tied to the story. The step's lines stay selected and,
  in Source, the code around them dimmed (0113). The marker reads the line
  the step expected, so drift still shows, now in the panel.
- The floating step bar is gone: the panel carries the controls while
  presenting and on phones, with Stop Presenting while presenting and Steps
  on phones. Present mode still hides the chrome, sets the story larger,
  and steps on plain keys (0113).
- A diff step shows Unified, so its lines and marker span the pane. A
  layout chosen during the walkthrough holds for it and is not saved;
  closing the walkthrough returns the saved layout.
- A note step's tab shows only the way back to the overview; its story is in
  the panel.

## Consequences

- The panel takes vertical room from the code; Collapse and the cap bound it.
- In the desktop app, a drag in the first moments of a reveal (under 3 s,
  usually under half a second) can still be pulled back while the diffs
  load.
- A diff above the file that loads after the reveal settles can move the
  file; the virtualizer's own anchoring keeps the rows in view steady.
- Present mode and phones lose the bottom bar their readers knew.
- No server or contract change.
