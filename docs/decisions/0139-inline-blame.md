# 0139: Inline blame

- Status: Accepted
- Date: 2026-11-13
- Extends: [0008](0008-line-links-and-copy-path.md)'s line selection,
  [0083](0083-server-structured-diffs.md)'s server diffs,
  [0112](0112-click-opens-commit-diff.md)'s commit review,
  [0114](0114-commit-search-and-file-history.md)'s path walk and file history,
  [0115](0115-source-change-markers.md)'s rereads

## Context

Asking who last changed a line, and why, meant leaving zero for `git blame`
or a forge. Zed and VS Code with GitLens show the caret line's author, age,
and subject after its text, and a hover gives the whole commit. Source is a
viewer: it has no caret, only the row last clicked and the URL's line
selection. srcz never runs `git` (0023), and memory matters (0080).

## Decision

- **Which line.** The active line: the row last clicked, the line number
  pressed (even inside a range), or a loaded `#L` anchor's first line. Not the
  hovered line: blame chasing the pointer is noise while reading.
- **Look.** After the active line's last character, a 2rem gap, then muted
  code-face text, at most 60ch and truncated: “Ada, 3 days ago · subject”,
  “Uncommitted changes”, or “Older than abc1234 · Mar 2024”. Lines never wrap,
  so a long line's blame is off to the right until scrolled. It is never
  selected or copied with the text.
- **Card.** The blame is a `HoverCard` trigger (a new primitive over Base
  UI's Popover): a precise pointer resting 400 ms opens it, a click or tap
  toggles it, Escape closes it. It shows the author and email, the age titled
  with the date, the subject and body (capped, scrolling), the short hash with
  Copy Hash, and Open Commit, Show File History, and, when known, Open PR #N.
  Open Commit opens the commit's review at the file and the line's place in
  that commit (`#f=<path>&R<originalLine>`). Uncommitted lines offer Show File
  History only. The trigger is no Tab stop; the palette's “Source Control ›
  Show Line Blame” opens the card focused on Open Commit.
- **Setting.** Settings › Source Control › Inline Blame, on by default.
  Nothing is read until a line of the document is active.
- **Endpoint.** `GET /api/blame?project&path[&at]` returns ranges of lines,
  each `commit`, `uncommitted`, or `boundary`, with its line in the commit,
  and a table of the commits they credit. Ranges cover every shown line; the
  web app ignores a response whose `lineCount` differs from its text. Binary
  files and files over 4 MiB are refused (`blameUnavailable`); folder projects
  return `repository: false`.
- **Walk.** zero's own blame in `internal/git`, not go-git's `Blame`, which
  cannot be cancelled, has no bound, and diffs whole trees at renames. It
  walks newest first over every parent; a line goes to the first parent, in
  order, holding it unchanged, as `git blame` does. A parent with the same
  blob takes every line without a diff; path entries come from 0114's per-tree
  memo; lines match through `internal/diff`. Renames are not followed. The
  walk stops after 50,000 commits or 10 s, or on cancellation; lines still
  pending become `boundary` at the commit where they waited, and the response
  is `truncated`. Shallow edges are boundaries too.
- **Working tree.** HEAD's blame is mapped through the server diff of HEAD
  and the working text: equal lines keep it, others are `uncommitted`.
  Untracked files and unborn HEAD are all uncommitted with no walk. With
  `at`, that commit is blamed. Results for `(repository, commit, path)` live in
  an 8-entry LRU, so rereads and further clicks only redo the cheap mapping.
- **Pull requests.** Only for a `github.com` origin (`git@`, `https://`,
  `ssh://` forms): a credited commit's subject ending `(#N)` or starting
  `Merge pull request #N`, else the same in the merge it was reached through
  on a non-first parent, which the walk carries for free. Other hosts come
  later.
- **Updates.** A live reread or a git change refetches; the last blame stays
  until the new one lands. Snapshots never refetch on git changes. Preview,
  Format, binary, and too-large documents show none.

## Memory

A 30,000-commit synthetic repository (30 folders of 30 files, one file
changed per commit, packed, 14 MiB), `zero browser` RSS in MiB, VmRSS / VmHWM:

| Step | RSS | Time |
| --- | --- | --- |
| origin/main idle | 19.0 / 19.0 | |
| this change idle | 18.8 / 18.8 | |
| Blame a file added in the last commit (200 lines) | 33.2 / 33.2 | 25 ms |
| Blame an old file (line 1 from the first commit, walks all 30,000) | 78.7 / 78.7 | 2,930 ms |
| The same file 3 more times (cached) | 52.9 / 81.2 | 21–29 ms each |
| A second old file | 79.2 / 81.2 | 2,695 ms |
| 9 more old files (cache churn) | 80.0 / 84.2 | 2.4–3.1 s each |

origin/main reaches 82.0 MiB on the same repository after 3 path-filtered
history pages. The growth is go-git's object cache and short-lived garbage,
as in 0114's walks.

## Consequences

- Lines from before a rename are credited to the rename commit.
- `internal/diff` coarsens very large diffs, which can credit a line to a
  newer commit than the one that wrote it.
- The first click in a file whose lines are ancient can take seconds in a deep
  repository; later clicks are instant.
- An empty file has `lineCount` 0 and shows no blame.
- A symlink is read through its target, so its lines are uncommitted.

## Rejected

- **go-git's `Blame`**: no cancellation or bound, and a full tree patch at
  every rename.
- **First-parent only**: cheaper, but merge-commit workflows would credit the
  merge for every line it brought.
- **Hover-following blame**, **a viewport-pinned label**, and **a full blame
  gutter**: the gutter (annotate) may come later on the same endpoint.
- **Diffing in the browser** for uncommitted lines: 0083.
