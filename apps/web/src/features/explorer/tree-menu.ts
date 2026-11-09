import type { NativeMenuItem } from "../../lib/desktop-bridge.ts"

// The Explorer row menu (decisions 0081, 0114): a native menu in the desktop
// app, a themed menu in browsers. Pure: FileTree runs the action whose id
// comes back.

export type TreeMenuAction = "file-history" | "reveal" | "copy-path" | "copy-relative-path"

const ACTIONS: readonly TreeMenuAction[] = ["file-history", "reveal", "copy-path", "copy-relative-path"]

export function isTreeMenuAction(id: string | null): id is TreeMenuAction {
  return ACTIONS.some((action) => action === id)
}

interface TreeMenuOptions {
  // file is set for file rows; folders have no file history.
  file: boolean
  // reveal is set where the app can reveal a path in the file manager.
  reveal: boolean
}

// treeMenuItems lists a row's actions in groups: Show File History for
// files, Reveal where offered, then the path copies.
export function treeMenuItems({ file, reveal }: TreeMenuOptions): NativeMenuItem[] {
  const items: NativeMenuItem[] = []
  if (file) items.push({ id: "file-history", label: "Show File History" }, { separator: true })
  if (reveal) items.push({ id: "reveal", label: "Reveal in File Manager" }, { separator: true })
  items.push({ id: "copy-path", label: "Copy Path" }, { id: "copy-relative-path", label: "Copy Relative Path" })
  return items
}

// treeRowPath is a tree row's project-relative path: directories drop the
// tree's trailing "/".
export function treeRowPath(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path
}

// absolutePath joins a project (an absolute path) and a relative path.
export function absolutePath(project: string, path: string): string {
  return `${project.endsWith("/") ? project.slice(0, -1) : project}/${path}`
}
