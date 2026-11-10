import { useCallback, useState } from "react"

import { isFeedbackFilter, unseenCount, type FeedbackFilter } from "./feedback-model.ts"
import { useFeedbackSeen } from "./use-feedback-seen.ts"
import { useFeedback, useFeedbackList } from "./use-feedback.ts"

const filterStorageKey = "zero-feedback-filter"

function readFilter(): FeedbackFilter {
  try {
    const stored = window.localStorage.getItem(filterStorageKey)
    return isFeedbackFilter(stored) ? stored : "open"
  } catch {
    return "open"
  }
}

export interface FeedbackViewOptions {
  project: string
  version: number
  // shown lists the repository's feedback for the branch picker.
  shown: boolean
  onChanged(): void
}

// useFeedbackView holds the Feedback activity's state (decision 0120): the
// feedback shown ("" for the checkout's branch), a file it is narrowed to,
// the status filter (saved per browser), and the agent replies not yet seen,
// which badge the activity.
export function useFeedbackView({ onChanged, project, shown, version }: FeedbackViewOptions) {
  const [selectedId, setSelectedId] = useState("")
  const [path, setPath] = useState("")
  const [filter, setFilterState] = useState(readFilter)
  const session = useFeedback({ project, id: selectedId, compare: null, version, enabled: project !== "", onChanged })
  const list = useFeedbackList(project, shown, version)
  const seen = useFeedbackSeen()
  const unseen = unseenCount(seen, session.feedback)

  // show selects feedback by id ("" for the checkout's branch), narrowed to
  // path when given.
  const show = useCallback((id: string, narrowTo = "") => {
    setSelectedId(id)
    setPath(narrowTo)
  }, [])
  const clearPath = useCallback(() => setPath(""), [])
  const setFilter = useCallback((next: FeedbackFilter) => {
    setFilterState(next)
    try {
      window.localStorage.setItem(filterStorageKey, next)
    } catch {
      // The filter still applies for the session without storage.
    }
  }, [])

  return { selectedId, show, path, clearPath, filter, setFilter, session, list, seen, unseen }
}

export type FeedbackViewState = ReturnType<typeof useFeedbackView>
