import { useSyncExternalStore } from "react"

import type { FeedbackThread } from "@zero/contracts"
import { markSeen, parseSeen, seenStorageKey, type FeedbackSeen } from "./feedback-model.ts"

// The agent replies this browser has shown (decision 0120), kept under
// zero-feedback-seen and shared by every thread zone and the Feedback view.

let current: FeedbackSeen | null = null
const listeners = new Set<() => void>()

function snapshot(): FeedbackSeen {
  if (current) return current
  try {
    current = parseSeen(JSON.parse(window.localStorage.getItem(seenStorageKey) ?? "null"))
  } catch {
    // Unavailable or malformed storage starts with nothing seen.
    current = {}
  }
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// useFeedbackSeen reads what this browser has seen.
export function useFeedbackSeen(): FeedbackSeen {
  return useSyncExternalStore(subscribe, snapshot)
}

// markFeedbackSeen records threads of feedback id as seen now.
export function markFeedbackSeen(id: string, threads: readonly FeedbackThread[]): void {
  const previous = snapshot()
  const next = markSeen(previous, id, threads)
  if (next === previous) return
  current = next
  try {
    window.localStorage.setItem(seenStorageKey, JSON.stringify(next))
  } catch {
    // Seen marks still apply for the session without storage.
  }
  for (const listener of listeners) listener()
}
