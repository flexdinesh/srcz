# 0132: A review's Open File shows the Explorer

- Status: Accepted
- Date: 2026-11-12
- Amends: [0035](0035-compare-list-and-review-tab.md) (Open File in a
  review's file header)

## Context

Open File in a review opened the document tab but left Source Control in the
sidebar. The file's place in the project, its neighbors, and its git status
were one more click away, and the sidebar no longer matched the active tab.

## Decision

- On desktop, Open File in a review opens the document and switches the
  sidebar to the Explorer, which selects and scrolls to the file.
- A hidden sidebar stays hidden: hiding it is the reader's choice.
- On phones the drawer stays closed, so the file is not covered.
- Other ways to open a file (Explorer, search, walkthrough steps, links) keep
  their sidebar as before.

## Consequences

Returning to the review tab leaves the Explorer showing; Source Control is
one click or `Ctrl+Shift+G` away.
