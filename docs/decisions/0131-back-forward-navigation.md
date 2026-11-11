# 0131: Back and forward navigation

- Status: Accepted
- Date: 2026-11-11
- Amends: [0056](0056-borderless-editor-tabs.md) (the tab strip leads with
  history buttons), [0097](0097-desktop-close-tab-shortcut.md) (a second
  native menu dispatches to the page)

## Context

Zero routes every tab switch, go-to-definition, search result, and walkthrough
step through the browser's history, so a browser's Back already returns to the
previous place. The desktop app's web view has no browser chrome: it had no way
back at all. Editors put Back and Forward beside the tabs (Zed's pane) or in
the title bar (VS Code), with keys and a list of where each leads.

## Decision

- **One history: the browser's.** Back and Forward move through the window's
  session history (`history.go`). Nothing new is recorded: entries are the
  router's pushes, and line selection, review scope, and remembered-tab opens
  keep replacing the current entry. Going back to a closed tab opens it again,
  as in Zed and VS Code. History crosses projects; another project's
  destination names its project.
- **An app-owned log.** The browser exposes only the current entry's index
  (TanStack's `__TSR_index`). A store above the workspace (it outlives the
  per-project remount) follows `router.history` and keeps each entry's index,
  key, href, and name; a push drops what Forward led to. The workspace names
  the entry on screen with its tab's name. The log lives in `sessionStorage`
  (`zero:navigation-history`), so Forward and names survive a reload; a log
  whose entry no longer matches the browser's starts over. Moves never leave
  the app's entries.
- **Buttons.** Two `bar` IconButtons (arrow left and right) lead the tab strip,
  closed by a tab's divider, hidden on phones. Tooltips name the destination
  and key; an unavailable direction is `aria-disabled` with its reason.
  Right-click, a 500 ms hold, or Shift+F10 lists up to 12 destinations,
  nearest first; picking one moves within the history, so Forward remains.
  The desktop app shows that list as a native menu.
- **Keys.** VS Code's: Ctrl+Alt+- and Ctrl+Shift+- outside macOS, Ctrl+- and
  Ctrl+Shift+- on macOS. Browsers keep their own Alt+Left, Cmd+[, and mouse
  buttons, which move through the same history.
- **Desktop Go menu.** Back, Forward (with the VS Code keys as accelerators),
  and Recent Locations dispatch a cancelable `zero:navigate` event (`back`,
  `forward`, `recent`). The menu owns those keys, so the page skips them in
  the desktop app and adds Alt+Left/Right (Linux), Cmd+[ and Cmd+] (macOS),
  and mouse buttons 3 and 4 (macOS), which a browser would handle itself.
- **Commands.** Go Back, Go Forward, and Recent Locations join the palette's
  Navigation commands. Recent Locations is a quick pick of each place once,
  most recently shown first, without the one on screen; it opens the place
  as a new entry, as JetBrains does. It has no default key.

## Consequences

- No cursor-position history: a line click replaces its entry, unlike Zed's
  per-selection jumps.
- A full page load (the desktop app's link handling, a typed URL) starts the
  browser's index over, so Back stops there.
- A desktop app older than its page (a newer remote server) has no Go menu:
  the VS Code keys do nothing there; the buttons and the browser's keys work.
- WebKitGTK reports a mouse's side buttons (X buttons 8 and 9) to the page as
  the primary button, and mygo exposes no native mouse buttons, so the Linux
  desktop app does not follow them.
