import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"

import { DialogShell } from "../components/ui/dialog-shell.tsx"
import { Kbd } from "../components/ui/kbd.tsx"
import { ListRow } from "../components/ui/list-row.tsx"
import { TextField } from "../components/ui/text-field.tsx"
import { matchRecent, projectName, recentLocations, type HistoryEntry, type HistoryLog } from "./navigation-history.ts"

interface RecentLocationsProps {
  log: HistoryLog
  // project is the one on screen; other projects' places name theirs.
  project: string
  registerOpen(open: (() => void) | null): void
  // onOpen opens a place as a new history entry.
  onOpen(href: string): void
}

// RecentLocations is a quick pick of the places this window showed, each
// once, most recent first (decision 0131). Typing filters by name or path.
export function RecentLocations({ log, onOpen, project, registerOpen }: RecentLocationsProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const matches = matchRecent(recentLocations(log), query)
  const active = matches[Math.min(activeIndex, matches.length - 1)]

  const show = useCallback(() => {
    if (!dialog.current || dialog.current.open) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery("")
    setActiveIndex(0)
    dialog.current.showModal()
    input.current?.focus()
  }, [])

  const close = useCallback((restoreFocus: boolean) => {
    if (dialog.current?.open) dialog.current.close()
    if (restoreFocus) returnFocus.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    registerOpen(show)
    return () => { registerOpen(null) }
  }, [registerOpen, show])

  useEffect(() => {
    if (!active) return
    list.current?.querySelector(`[data-recent="${CSS.escape(active.key)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  function open(entry: HistoryEntry | undefined) {
    if (!entry) return
    close(false)
    onOpen(entry.href)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!matches.length) return
      const current = active ? matches.indexOf(active) : 0
      const step = event.key === "ArrowDown" ? 1 : -1
      setActiveIndex((current + step + matches.length) % matches.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      open(active)
    } else if (event.key === "Escape") {
      event.preventDefault()
      close(true)
    }
  }

  const optionID = (entry: HistoryEntry) => `recent-option-${entry.index}`

  return (
    <DialogShell
      ref={dialog}
      variant="palette"
      backdrop="transparent"
      className="search-dialog command-palette"
      aria-labelledby="recent-locations-title"
      onCancel={(event) => { event.preventDefault(); close(true) }}
      onClick={(event) => { if (event.target === dialog.current) close(true) }}
    >
      <div className="search-shell">
        <h2 id="recent-locations-title" className="visually-hidden">Recent Locations</h2>
        <TextField
          variant="palette"
          className="command-field"
          trailing={<Kbd>Esc</Kbd>}
          inputRef={input}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Go to a recent location"
          aria-label="Recent location"
          role="combobox"
          aria-controls="recent-results"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={active ? optionID(active) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={onKeyDown}
        />
        {matches.length === 0 && (
          <div className="search-status" role="status">{query ? "No matching locations" : "No other locations yet"}</div>
        )}
        <div ref={list} id="recent-results" className="search-results command-results" role="listbox" aria-label="Recent locations">
          {matches.map((entry, index) => {
            const where = entry.project && entry.project !== project ? projectName(entry.project) : ""
            const detail = [entry.title === entry.label ? "" : entry.title, where].filter(Boolean).join(" · ")
            return (
              <ListRow
                key={entry.key}
                id={optionID(entry)}
                data-recent={entry.key}
                density="pick"
                active={entry === active}
                className="command-option"
                role="option"
                aria-selected={entry === active}
                aria-label={detail ? `${entry.label}, ${detail}` : entry.label}
                title={entry.title}
                onClick={() => open(entry)}
                onMouseMove={entry === active ? undefined : () => setActiveIndex(index)}
              >
                <span className="command-title">{entry.label}</span>
                {detail && <span className="command-value">{detail}</span>}
              </ListRow>
            )
          })}
        </div>
      </div>
    </DialogShell>
  )
}
