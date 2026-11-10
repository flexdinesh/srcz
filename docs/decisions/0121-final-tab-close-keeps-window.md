# 0121: Closing the final tab keeps the desktop window

- Status: Accepted
- Date: 2026-11-10
- Supersedes: [0097](0097-desktop-close-tab-shortcut.md) (closing the final tab)

Cmd+W on macOS and Ctrl+W on Linux still close the active workspace tab.
Closing the final tab no longer closes the window: the empty workspace stays,
matching the tab's X. The shortcut in an empty workspace closes the window, so
two presses close a window with one tab.

An accidental final close no longer loses the window, and closing a window
stays one deliberate press away. The `zero:close-tab` event and the
sender-checked `closeWindow()` bridge method are unchanged. The window closes
only from an already empty workspace, whose memory the final tab's close saved,
so React no longer waits for navigation before closing.
