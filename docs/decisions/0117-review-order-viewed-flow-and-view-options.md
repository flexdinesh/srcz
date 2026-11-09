# 0117: One review order, a quicker Viewed flow, and View options

- Status: Accepted
- Date: 2026-11-09
- Revises: [0035](0035-compare-list-and-review-tab.md)'s "a new blob clears
  the mark" and its toolbar; [0040](0040-source-control-panes-and-review-files-rail.md)'s
  flat Uncommitted list order and Files rail; [0051](0051-branch-review-with-uncommitted.md)'s
  "files lose their mark in the other scope"

## Context

Reviewing changes had small frictions that added up:

- The flat Uncommitted list kept the server's order, while the review, the
  Files tree, and F7 read in tree order (folders first). Clicking down the
  list jumped around the review.
- A renamed file with no line changes read `+0 −0`, which looks like nothing
  changed.
- The Uncommitted review titled itself "Uncommitted changes" while every
  other review used its tab label.
- Finding a file in a large commit's rail meant scrolling the tree, and
  viewed files stayed in the way.
- Marking a file Viewed collapsed it, but the reader then had to find the
  next file. When the file changed, its mark vanished silently, so a reader
  could not tell a file they had never opened from one that moved since.
- The toolbar held ten controls; four were options set once and rarely
  touched.

## Decision

- **One order.** The flat Uncommitted list sorts with `displayOrder`, the
  Files tree's order, so the list, the review, the rail, and F7 agree.
- **Pure renames.** A renamed file whose counted lines are `+0 −0` reads a
  muted "renamed" in the Uncommitted list, the Files tree (Uncommitted's
  tree mode, the rail, and its sheet), and the review's file header. The list
  row's name drops the counts; the status already says Renamed.
- **One header.** The Uncommitted review titles itself "Uncommitted", its tab
  label, like other reviews; its window title stays "Uncommitted changes".
- **Rail filter.** Under the rail's header, a "Filter files by path" field
  keeps files whose path, or a rename's old path, holds every
  whitespace-separated term, ignoring case; it shows "3 / 12" while it hides
  anything, Escape clears it, and it is never saved. A "Hide viewed files"
  toggle in the field drops viewed files and is saved per browser in
  `srcz-source-control` (`railHideViewed`). An empty result reads "No files
  match." or "Every file is viewed.". The phone sheet has the same controls.
- **Viewed flow.** Marking a file Viewed collapses it and moves the review to
  the next file not yet viewed, wrapping past the end, as the fragment does
  (`#f=`). Unmarking opens the file and stays put.
- **Changed since viewed.** A mark keeps the blob it was made at, as it
  always did. A mark at another blob now reads "Changed since viewed"
  (`warning`, 12px; "Changed" below 30rem, its title keeping the rest)
  beside the Viewed toggle: the file opens, the toggle is unpressed, and it
  does not count as viewed. Marking it again takes the new blob. The `srcz-review-viewed` format is unchanged, so stored marks need no
  migration. An open or closed choice the user made lapses when the file's
  blob changes, so a live update reopens the file.
- **Review keys.** While a review shows, `]` and `[` go to the next and
  previous file (no wrap) and `v` toggles Viewed on the file in view. They
  apply when focus is in the review pane, its toolbar, its Files rail, or
  nowhere, never in a text field, while composing, or with Ctrl, Cmd, or
  Alt. The Viewed
  toggle carries `aria-keyshortcuts="v"` and "Mark as viewed (V)"; `]` and
  `[` have no control, so the review's root lists all three in
  `aria-keyshortcuts` and the "N of M viewed" total names them in its
  tooltip.
- **View options.** The toolbar keeps Split/Unified, Previous and Next
  change, Collapse/Expand All Files, and Files. Wrap lines, Ignore
  whitespace, Expand unchanged lines (checkbox items), and Inline changes
  (Word, Character, Off, a labelled radio group) move into one "View options"
  menu behind a settings icon. The menu stays open while choices change; a
  4px accent square marks the trigger while any choice differs from its
  default. The Menu primitives gain a group label class. Split's narrow-width
  rules are unchanged.

## Consequences

- Marks key on path and blob per project, not per compare: a file viewed in
  one review reads "Changed since viewed" in another whose side differs (a
  branch review with and without uncommitted changes, or two commits), where
  it used to read unviewed.
- The jump after marking replaces the fragment, so a line selection in the
  marked file is dropped.
- `]`, `[`, and `v` are new keys in a review; text fields, the sidebar's lists,
  and dialogs keep them.
- The four options take one more click to reach.
