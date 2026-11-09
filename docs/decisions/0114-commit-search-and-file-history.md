# 0114: Commit search and file history

- Status: Accepted
- Date: 2026-11-09
- Extends: [0027](0027-commit-history-in-source-control.md), [0040](0040-source-control-panes-and-review-files-rail.md), [0112](0112-click-opens-commit-diff.md)
- Revises: [0081](0081-desktop-bridge-v2-native-features.md)'s "browsers keep rows without a menu"

## Context

Commits listed a range 50 at a time with no way to find a commit by its
message, author, or hash, and no way to ask which commits changed a file.
Both meant scrolling with Load more or leaving for another tool. srcz never
runs `git` (0023), and memory matters (0080).

## Decision

- `GET /api/commits` takes `q` and `path`. `q` (trimmed, at most 256
  characters) keeps commits whose message, author name, or author email holds
  it, ignoring case, or whose hash starts with it when it is 4 or more
  hexadecimal digits. `path`, repository-relative and validated like other git
  paths, keeps commits whose tree entry at that path differs from their first
  parent's in hash, mode, or presence; a root or shallow commit compares with
  an empty tree. A folder path matches changes under it. Renames are not
  followed. The response echoes `query` and `path`. `CommitsRequest` gains
  `Query` and `Path`; every client (HTTP, Unix, in-process) carries them.
- The `git.Log` walk filters as it goes. Path checks read only the trees
  along the path, never a full tree diff, and memoize the entry per root
  tree, which a commit and its parent share; identical root trees skip the
  read.
- Each filtered page tests at most 10,000 commits. `skip` counts walk
  positions, not matches, and every response carries `next`, the `skip` for
  the following page. A page that stops on the cap with fewer matches than its
  limit, or none, returns `more` and its `next`, and Load more continues from
  there. Unfiltered `next` equals `skip` plus the page, so existing paging is
  unchanged. Walk limits, the 20s timeout, and cancellation stay.
- The Commits header gains a search icon (“Filter Commits”, pressed while
  shown) before Branch/All. It shows a filter row above the list: a field
  (“Message, author, or hash”, typing applies after 200ms) and, with a path, a
  removable chip (file icon, the path truncated from the start, ×). Escape in
  the row clears both and hides it, returning focus to the icon. Branch/All and
  paging still apply. An empty result reads “No commits match.”; one that
  stopped on the cap reads “No commits match in the 10,000 most recent
  commits.” and the more row reads “Search older commits”. Results are
  announced politely. The row is transient: never persisted.
- With a path, opening a commit or range opens its review at that file
  (`#f=<path>`).
- Show File History sets the path, opens the Commits pane, reveals Source
  Control, and focuses the field (phones skip the focus so no keyboard opens).
  It is offered in the Explorer menu for files (the desktop app's native menu
  and, new in browsers, a themed menu with Copy Path and Copy Relative Path),
  the tab menu for working-tree document tabs (in-page and native), and the
  command palette as “Source Control › Show File History”, which acts on the
  working-tree file in view and otherwise opens the empty filter row.

## Memory

Measured on a 30,000-commit synthetic repository (30 folders of 30 files, one
file changed per commit, packed), `srcz browser` RSS in kB, VmRSS / VmHWM:

| Step | origin/main | this change |
| --- | --- | --- |
| Idle | 18,264 / 18,264 | 20,228 / 20,228 |
| After 7 unfiltered pages | 47,092 / 49,188 | 48,036 / 49,792 |
| After 3 pages at skip 20,000 | 66,832 / 70,680 | 69,256 / 69,256 |
| After 3 rounds of filtered pages (author query, path, a query that matches nothing, the same at skip 20,000) | n/a | 75,336 / 77,416 |

Unfiltered paging is unchanged within noise. Filtered pages read more
objects than a 50-commit page, so go-git's object cache, bounded at 96 MiB,
fills further; a page that tests 10,000 commits takes about 0.4s for a query
and 0.2s to 1.2s for a path.

## Consequences

- History before a rename does not show under the new path.
- A sparse match can take several Load more clicks, each testing 10,000
  commits.
- A merge counts as touching a path when it differs from its first parent, so
  a merge that brought a file's changes shows in that file's history, unlike
  `git log -- path`'s history simplification.
- Paging past the first filtered page rewalks the skipped positions, as
  unfiltered paging already does.
