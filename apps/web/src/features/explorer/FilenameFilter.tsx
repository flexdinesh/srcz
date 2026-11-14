import { FunnelIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react"

import { parseFilenameFilter, type FilenameMatcher } from "./filename-filter.ts"

import { IconButton } from "../../components/ui/icon-button.tsx"
import { TextField } from "../../components/ui/text-field.tsx"

const debounceMs = 150

interface SettledFilter {
  // Text most recently evaluated; the tree keeps the last valid filter while text is invalid.
  text: string
  applied: string
  matcher: FilenameMatcher | null
  invalidPattern: string | null
}

const emptyFilter: SettledFilter = { text: "", applied: "", matcher: null, invalidPattern: null }

export interface FilenameFilterState {
  text: string
  applied: string
  matcher: FilenameMatcher | null
  invalidPattern: string | null
  // shown says whether the filter row is visible; hiding it keeps the filter.
  shown: boolean
  setText(text: string): void
  setShown(shown: boolean): void
  clear(): void
}

// Explorer-owned visibility filter. Owned above responsive remounts and never persisted.
export function useFilenameFilter(): FilenameFilterState {
  const [text, setTextValue] = useState("")
  const [shown, setShown] = useState(false)
  const [settled, setSettled] = useState(emptyFilter)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const apply = useCallback((value: string) => {
    const result = parseFilenameFilter(value)
    setSettled((previous) => result.valid
      ? { text: value, applied: value.trim(), matcher: result.matcher, invalidPattern: null }
      : { ...previous, text: value, invalidPattern: result.pattern })
  }, [])
  const setText = useCallback((value: string) => {
    setTextValue(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => apply(value), debounceMs)
  }, [apply])
  const clear = useCallback(() => {
    clearTimeout(timer.current)
    setTextValue("")
    apply("")
  }, [apply])
  return {
    text,
    applied: settled.applied,
    matcher: settled.matcher,
    invalidPattern: settled.text === text ? settled.invalidPattern : null,
    shown,
    setText,
    setShown,
    clear,
  }
}

interface FilenameFilterProps {
  filter: FilenameFilterState
  inputRef: RefObject<HTMLInputElement | null>
  totalCount: number
  visibleCount: number
  onFocusTree(): void
  // onHide hides the row: Escape in an empty field.
  onHide(): void
}

export function FilenameFilter({ filter, inputRef: input, totalCount, visibleCount, onFocusTree, onHide }: FilenameFilterProps) {
  const errorId = useId()
  const active = filter.matcher !== null

  return <div className="filename-filter">
    <TextField className="filename-filter-field" inputClassName="filename-filter-input" inputRef={input}
      icon={<FunnelIcon />} invalid={filter.invalidPattern !== null} type="text" aria-label="Filter files by name"
      placeholder="Filter: *.md, *.go" value={filter.text} spellCheck={false} autoComplete="off" autoCapitalize="off"
      aria-describedby={filter.invalidPattern !== null ? errorId : undefined}
      onChange={(event) => filter.setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (filter.text) filter.clear()
          else onHide()
        } else if (event.key === "Enter" || event.key === "ArrowDown") {
          onFocusTree()
        } else return
        event.preventDefault()
        event.stopPropagation()
      }}
      trailing={<>
        <span className="filename-filter-count" role="status">
          {active && <>
            <span aria-hidden="true">{visibleCount} / {totalCount}</span>
            <span className="visually-hidden">{visibleCount} of {totalCount} files match</span>
          </>}
        </span>
        {filter.text && <IconButton className="filename-filter-clear" size="xs" label="Clear filter" icon={<XIcon aria-hidden="true" />}
          onClick={() => {
            filter.clear()
            input.current?.focus()
          }} />}
      </>} />
    {filter.invalidPattern !== null && <p id={errorId} className="filename-filter-error">Invalid pattern "{filter.invalidPattern}"</p>}
  </div>
}
