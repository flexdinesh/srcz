import { within } from "./project-picker.ts"

// Pure pieces of FolderProblem (decision 0146).

// privacySettingsUrl opens macOS's Full Disk Access list; the desktop app
// lets only local windows open it.
export const privacySettingsUrl = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

// isFolderProblem reports a page error code for a folder zero cannot read.
export function isFolderProblem(code: string | undefined): boolean {
  return code === "privacyBlocked" || code === "folderUnreadable"
}

// servedRootOf is the served root holding project, or "".
export function servedRootOf(project: string, roots: readonly string[]): string {
  return roots.find((root) => within(project, root)) ?? ""
}
