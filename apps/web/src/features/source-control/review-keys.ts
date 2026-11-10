// Review keys (decision 0117): outside text fields, ] and [ go to the next
// and previous file, and v toggles Viewed on the file in view; c comments
// on the selected lines (decision 0120). Pure.

export type ReviewKeyCommand = "nextFile" | "previousFile" | "toggleViewed" | "comment"

// reviewKeyShortcuts are the keys as aria-keyshortcuts names them.
export const reviewKeyShortcuts: Readonly<Record<ReviewKeyCommand, string>> = { nextFile: "]", previousFile: "[", toggleViewed: "v", comment: "c" }

export interface ReviewKeyEvent {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  isComposing: boolean
  // textField: the key went to an input, textarea, select, or editable text.
  textField: boolean
}

// reviewKeyCommand maps a key press to its review command; modified keys,
// composition, and text fields never map.
export function reviewKeyCommand(event: ReviewKeyEvent): ReviewKeyCommand | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.textField) return null
  if (event.key === "]") return "nextFile"
  if (event.key === "[") return "previousFile"
  if (event.key === "v") return "toggleViewed"
  if (event.key === "c") return "comment"
  return null
}

// adjacentFile is the file after (1) or before (-1) current in review order,
// without wrapping; from no current file, the first or the last.
export function adjacentFile(paths: readonly string[], current: string, direction: 1 | -1): string | null {
  const index = paths.indexOf(current)
  if (index < 0) return (direction === 1 ? paths[0] : paths.at(-1)) ?? null
  return paths[index + direction] ?? null
}

// nextUnviewed is the first file after from that unviewed holds, wrapping
// past the end; from itself never counts.
export function nextUnviewed(paths: readonly string[], from: string, unviewed: (path: string) => boolean): string | null {
  const start = paths.indexOf(from)
  for (let offset = 1; offset < paths.length + (start < 0 ? 1 : 0); offset++) {
    const path = paths[(start + offset + paths.length) % paths.length]
    if (path !== undefined && path !== from && unviewed(path)) return path
  }
  return null
}
