import { isRecord } from "../../api/http.ts"

// Whether the narration panel is collapsed (decision 0135), per browser under
// zero-narration, across steps and walkthroughs. Until the reader chooses,
// phones start collapsed, so the code keeps the small screen.

const storageKey = "zero-narration"

// parseNarrationCollapsed is the stored choice, or null when none was made.
export function parseNarrationCollapsed(value: unknown): boolean | null {
  return isRecord(value) && typeof value.collapsed === "boolean" ? value.collapsed : null
}

// narrationCollapsed is the panel's state: the reader's choice, else
// collapsed on phones only.
export function narrationCollapsed(stored: boolean | null, mobile: boolean): boolean {
  return stored ?? mobile
}

export function readNarrationCollapsed(): boolean | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? parseNarrationCollapsed(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function storeNarrationCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ collapsed }))
  } catch {
    // The choice still holds for the session when storage is unavailable.
  }
}
