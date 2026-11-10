import { useLayoutEffect } from "react"

import { desktopBridge } from "../lib/desktop-bridge.ts"
import type { WorkspaceTab } from "./workspace-tabs.ts"

// The native menu owns Cmd/Ctrl+W. Close through the workspace so routing,
// scroll cleanup, and remembered tabs follow the same path as the tab's X.
// Closing the final tab leaves the empty workspace; the shortcut there closes
// the window, whose memory already holds the empty workspace (decision 0121).
export function useDesktopCloseTab(active: WorkspaceTab | null, tabs: readonly WorkspaceTab[], closeTab: (tab: WorkspaceTab) => void) {
  useLayoutEffect(() => {
    const closeWindow = desktopBridge()?.closeWindow
    if (!closeWindow) return
    function close(event: Event) {
      event.preventDefault()
      const tab = active ?? tabs.at(-1)
      if (tab) closeTab(tab)
      else closeWindow?.()
    }
    window.addEventListener("zero:close-tab", close)
    return () => window.removeEventListener("zero:close-tab", close)
  }, [active, closeTab, tabs])
}
