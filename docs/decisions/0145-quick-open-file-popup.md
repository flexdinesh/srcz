# 0145: Quick Open file popup

- Status: Accepted
- Date: 2026-11-14
- Amends: [0006](0006-explorer-filename-filter.md) (the filter row hides
  behind a toggle; Quick Open ignores the filter, so filename search no longer
  intersects it), [0014](0014-command-palette.md) (Cmd/Ctrl+P is Quick Open;
  `>` hands off to the palette and Backspace returns, so the palette now has a
  `>`-less file mode)

## Context

File search was Pierre's in-tree search: a "Search…" field in the explorer
shelf that hid non-matching rows and expanded matching ancestors. It needed
the Explorer showing, ranked nothing (path order only), showed no recents, and
could not open a file at a line. VS Code's and Zed's Quick Open is a popup
that ranks fuzzy matches by base name, lists recent files, and takes
`path:line`.

## Decision

- **Quick Open.** Cmd/Ctrl+P (Cmd/Ctrl+K kept as an alias), the explorer's
  Search files button, Welcome's and the empty pane's Find a file, and
  "Navigation › Go to File…" in the command palette open a popup on the
  content-palette frame. Opening never changes the sidebar; on phones the
  drawer closes first.
- **Scope.** Every file in the page tree (within `--depth`, gitignored
  included, as the tree). The explorer filename filter does not apply.
- **Recents.** An empty query lists "recently opened": this project's
  working-tree files this window showed, from the navigation-history log
  (decision 0131), most recent first, without the file on screen or files no
  longer in the tree.
- **Matching.** Every space-separated term must match, case-insensitive. Per
  term, a contiguous hit in the base name (prefix, then word start, ranks
  higher) beats a contiguous hit elsewhere in the path, which beats in-order
  characters, placed right to left so they land in the base name. Ties: shorter
  path, then path order. At most 100 rows. Matching is pure
  (`quick-open.ts`) and runs on the main thread.
- **Lines.** `path:line` filters on the path and opens the file at `#L<line>`
  (a trailing `:column` is ignored). A bare `:line` goes to that line in the
  text document on screen.
- **Commands.** `>` as the first character closes Quick Open and opens the
  command palette with the rest of the text; Backspace in the palette's empty
  field returns to Quick Open, as in VS Code. Focus restore carries across.
- **Explorer.** Pierre's in-tree search is removed. The header holds Search
  files (opens Quick Open) and Filter files by name, a funnel toggle that
  shows the filename filter row. Hiding the row keeps the filter applied; the
  funnel then carries an accent dot (IconButton `indicator`) and its tooltip
  names the globs.

## Consequences

- Recents are per window session (`sessionStorage`): a new window starts with
  none.
- The tree no longer expands matching ancestors during a search; Collapse and
  Expand all is no longer disabled while searching.
- Matching on the main thread measured a median of about 19ms over 50,000
  paths on a dev machine; move it to a worker only if large trees need it.
