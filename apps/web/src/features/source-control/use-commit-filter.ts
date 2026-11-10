import { useCallback, useEffect, useRef, useState } from "react"

import { appliedFilter, emptyFilter, fileHistory, type CommitFilter, type HistoryFilter } from "./commit-filter.ts"

const debounceMs = 200

// useCommitFilter owns the Commits filter (decisions 0114, 0129): what the
// field shows, and the filter reads apply, which follows typing after 200ms
// and clearing or a path change at once. Never persisted.
export function useCommitFilter() {
  const [filter, setFilter] = useState<CommitFilter>(emptyFilter)
  const [applied, setApplied] = useState<HistoryFilter>(() => appliedFilter(emptyFilter))
  // focusPending asks the filter field to take focus once it shows; the
  // field clears it with focused.
  const [focusPending, setFocusPending] = useState(false)
  const requestFocus = useCallback(() => setFocusPending(true), [])
  const focused = useCallback(() => setFocusPending(false), [])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  // update changes the filter; a typed query waits, everything else applies now.
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
  // clear drops the query and the path.
  const clear = useCallback(() => update(emptyFilter), [update])
  // showFileHistory filters to a file; focus moves to the field, which phones
  // skip so no keyboard covers the list.
  const showFileHistory = useCallback((path: string, focus: boolean) => {
    update(fileHistory(path))
    if (focus) requestFocus()
  }, [requestFocus, update])

  return { filter, applied, focusPending, setQuery, clearPath, clear, showFileHistory, requestFocus, focused }
}

export type CommitFilterState = ReturnType<typeof useCommitFilter>
