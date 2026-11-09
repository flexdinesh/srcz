import { useCallback, useEffect, useRef, useState } from "react"

import { appliedFilter, closedFilter, fileHistory, type CommitFilter, type HistoryFilter } from "./commit-filter.ts"

const debounceMs = 200

// useCommitFilter owns the Commits filter row (decision 0114): what the row
// shows, and the filter reads apply, which follows typing after 200ms and
// opening, closing, or a path change at once. Never persisted.
export function useCommitFilter() {
  const [filter, setFilter] = useState<CommitFilter>(closedFilter)
  const [applied, setApplied] = useState<HistoryFilter>(() => appliedFilter(closedFilter))
  // focusPending asks the filter field to take focus once it shows; the
  // field clears it with focused.
  const [focusPending, setFocusPending] = useState(false)
  const requestFocus = useCallback(() => setFocusPending(true), [])
  const focused = useCallback(() => setFocusPending(false), [])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  // update changes the row; a typed query waits, everything else applies now.
  const update = useCallback((next: CommitFilter, wait = false) => {
    setFilter(next)
    clearTimeout(timer.current)
    const nextApplied = appliedFilter(next)
    const apply = () => setApplied((previous) =>
      previous.query === nextApplied.query && previous.path === nextApplied.path ? previous : nextApplied)
    if (wait) timer.current = setTimeout(apply, debounceMs)
    else apply()
  }, [])

  const setQuery = useCallback((query: string) => update({ ...filter, query }, true), [filter, update])
  const clearPath = useCallback(() => update({ ...filter, path: "" }), [filter, update])
  const show = useCallback(() => update({ ...filter, open: true }), [filter, update])
  // close clears and hides the row.
  const close = useCallback(() => update(closedFilter), [update])
  // showFileHistory opens the row on a file; focus moves to its field, which
  // phones skip so no keyboard covers the list.
  const showFileHistory = useCallback((path: string, focus: boolean) => {
    update(fileHistory(path))
    if (focus) requestFocus()
  }, [requestFocus, update])

  return { filter, applied, focusPending, setQuery, clearPath, show, close, showFileHistory, requestFocus, focused }
}

export type CommitFilterState = ReturnType<typeof useCommitFilter>
