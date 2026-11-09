import type { NativeMenuItem } from "../lib/desktop-bridge.ts"
import type { WorkspaceTab } from "./workspace-tabs.ts"

// The tab context menu as native menu items for the desktop app (decision
// 0081). Pure: TabBar runs the action whose id comes back.

export type TabMenuAction = "keep-open" | "close" | "close-others" | "close-right" | "close-all" | "file-history" | "reveal"

const ACTIONS: readonly TabMenuAction[] = ["keep-open", "close", "close-others", "close-right", "close-all", "file-history", "reveal"]

export const REVEAL_LABEL = "Reveal in File Manager"
export const KEEP_OPEN_LABEL = "Keep Open"
export const FILE_HISTORY_LABEL = "Show File History"

export function isTabMenuAction(id: string | null): id is TabMenuAction {
  return ACTIONS.some((action) => action === id)
}

// revealablePath is a working-tree document tab's path; other tabs (reviews,
// walkthroughs, Welcome, commit snapshots) have nothing on disk to reveal.
export function revealablePath(tab: WorkspaceTab): string | null {
  return tab.kind === "document" && !tab.at ? tab.path : null
}

// tabMenuItems mirrors the in-page tab menu: Keep Open first on the preview
// tab (decision 0113); working-tree documents add Show File History (decision
// 0114), and Reveal when the app offers it.
export function tabMenuItems(tab: WorkspaceTab, index: number, count: number, canReveal: boolean, preview = false): NativeMenuItem[] {
  const items: NativeMenuItem[] = [
    ...(preview ? [{ id: "keep-open", label: KEEP_OPEN_LABEL }, { separator: true }] satisfies NativeMenuItem[] : []),
    { id: "close", label: "Close" },
    { id: "close-others", label: "Close Others", enabled: count > 1 },
    { id: "close-right", label: "Close to the Right", enabled: index < count - 1 },
    { separator: true },
    { id: "close-all", label: "Close All" },
  ]
  if (revealablePath(tab) === null) return items
  items.push({ separator: true }, { id: "file-history", label: FILE_HISTORY_LABEL })
  if (canReveal) items.push({ id: "reveal", label: REVEAL_LABEL })
  return items
}
