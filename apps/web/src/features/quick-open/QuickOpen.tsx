import { CornerDownRightIcon, SearchIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"

import { indexFiles, matchFiles, parseQuickOpenQuery, recentFiles, splitPath } from "./quick-open.ts"

import { FileIcon } from "../../components/FileIcon.tsx"
import { DialogShell } from "../../components/ui/dialog-shell.tsx"
import { Kbd } from "../../components/ui/kbd.tsx"
import { ListRow } from "../../components/ui/list-row.tsx"
import { TextField } from "../../components/ui/text-field.tsx"
import type { HighlightRange } from "../search/search-engine.ts"
import { highlightedParts } from "../search/search-highlights.ts"
import type { HistoryLog } from "../../workspace/navigation-history.ts"

// Rows shown at once; the status line counts the rest.
const resultLimit = 100

export interface QuickOpenOptions {
  // query seeds the field, e.g. when Backspace leaves the command palette.
  query?: string
  // returnFocus overrides where focus returns on Escape.
  returnFocus?: HTMLElement | null
}

interface QuickOpenProps {
  files: readonly string[]
  log: HistoryLog
  project: string
  // current is the working-tree file on screen; recents leave it out.
  current: string
  // lineTarget names the text document a bare `:42` moves in, or "".
  lineTarget: string
  registerOpen(open: ((options?: QuickOpenOptions) => void) | null): void
  // beforeShow closes the mobile drawer so the popup does not stack on it.
  beforeShow(): void
  onOpen(path: string, line: number | null): void
  onGoToLine(line: number): void
  // onCommands hands `>` and the text after it to the command palette.
  onCommands(text: string, returnFocus: HTMLElement | null): void
}

type Option =
  | { key: string; kind: "file"; path: string; line: number | null; name: readonly HighlightRange[]; directory: readonly HighlightRange[] }
  | { key: string; kind: "line"; line: number }

function Highlighted({ text, ranges }: { text: string; ranges: readonly HighlightRange[] }) {
  return highlightedParts(text, ranges).map((part, index) => (
    part.highlighted ? <mark key={index}>{part.text}</mark> : part.text
  ))
}

const fileWord = (count: number) => `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`

// QuickOpen finds a file by name, as VS Code's and Zed's Cmd/Ctrl+P do:
// recent files first, fuzzy matches as you type, `path:42` and `:42` for a
// line, and `>` for commands. Arrows move, Enter opens, Escape closes.
export function QuickOpen({ files, log, project, current, lineTarget, registerOpen, beforeShow, onOpen, onGoToLine, onCommands }: QuickOpenProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [shown, setShown] = useState(false)
  const latest = useRef({ beforeShow })
  useEffect(() => { latest.current = { beforeShow } }, [beforeShow])

  const index = useMemo(() => indexFiles(files), [files])
  const fileSet = useMemo(() => new Set(files), [files])
  const parsed = parseQuickOpenQuery(query)
  const recents = useMemo(() => shown ? recentFiles(log, project, fileSet, current) : [], [current, fileSet, log, project, shown])
  const result = useMemo(() => {
    const files = parseQuickOpenQuery(query)
    return files.kind === "files" && files.terms.length > 0 ? matchFiles(index, files.terms, resultLimit) : null
  }, [index, query])

  let options: Option[] = []
  let status = ""
  let group = ""
  if (parsed.kind === "line") {
    if (lineTarget) options = [{ key: "line", kind: "line", line: parsed.line }]
    else status = "Open a text document to go to a line"
  } else if (parsed.kind === "files" && result) {
    options = result.matches.map((match) => ({
      key: match.path, kind: "file", path: match.path, line: parsed.line, name: match.name, directory: match.directory,
    }))
    if (result.total === 0) status = "No matching files"
    else if (result.total > result.matches.length) status = `Showing ${result.matches.length} of ${result.total.toLocaleString()} matches`
  } else if (parsed.kind === "files") {
    options = recents.map((path) => ({ key: path, kind: "file", path, line: parsed.line, name: [], directory: [] }))
    if (options.length) group = "recently opened"
    else status = files.length ? `Type to search ${fileWord(files.length)}` : "No files in this project"
  }
  const active = options[Math.min(activeIndex, options.length - 1)]

  const show = useCallback((options?: QuickOpenOptions) => {
    if (!dialog.current || dialog.current.open) return
    returnFocus.current = options?.returnFocus !== undefined
      ? options.returnFocus
      : document.activeElement instanceof HTMLElement ? document.activeElement : null
    latest.current.beforeShow()
    setQuery(options?.query ?? "")
    setActiveIndex(0)
    setShown(true)
    dialog.current.showModal()
    input.current?.focus()
  }, [])

  const close = useCallback((restoreFocus: boolean) => {
    if (dialog.current?.open) dialog.current.close()
    setShown(false)
    if (restoreFocus) returnFocus.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    registerOpen(show)
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key !== "p" && key !== "k") return
      event.preventDefault()
      show()
    }
    document.addEventListener("keydown", shortcut)
    return () => {
      registerOpen(null)
      document.removeEventListener("keydown", shortcut)
    }
  }, [registerOpen, show])

  useEffect(() => {
    if (!active) return
    list.current?.querySelector(`[data-quick-open="${CSS.escape(active.key)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  function choose(option: Option | undefined) {
    if (!option) return
    close(false)
    if (option.kind === "line") onGoToLine(option.line)
    else onOpen(option.path, option.line)
  }

  function change(value: string) {
    if (value.startsWith(">")) {
      // Close first: the command palette takes focus once this dialog is gone.
      const target = returnFocus.current
      close(false)
      onCommands(value.slice(1), target)
      return
    }
    setQuery(value)
    setActiveIndex(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!options.length) return
      const position = active ? options.indexOf(active) : 0
      const step = event.key === "ArrowDown" ? 1 : -1
      setActiveIndex((position + step + options.length) % options.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      choose(active)
    } else if (event.key === "Escape") {
      event.preventDefault()
      close(true)
    }
  }

  const optionID = (option: Option) => `quick-open-option-${options.indexOf(option)}`

  return (
    <DialogShell
      ref={dialog}
      variant="palette"
      backdrop="transparent"
      className="search-dialog quick-open"
      aria-labelledby="quick-open-title"
      onCancel={(event) => { event.preventDefault(); close(true) }}
      onClick={(event) => { if (event.target === dialog.current) close(true) }}
    >
      <div className="search-shell">
        <h2 id="quick-open-title" className="visually-hidden">Go to file</h2>
        <TextField
          variant="palette"
          className="command-field"
          icon={<SearchIcon />}
          trailing={<Kbd>Esc</Kbd>}
          inputRef={input}
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search files by name (append : to go to line)"
          aria-label="Go to file"
          role="combobox"
          aria-controls="quick-open-results"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={active ? optionID(active) : undefined}
          value={query}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="search-status" role="status">{status}</div>
        <div ref={list} id="quick-open-results" className="search-results quick-open-results" role="listbox" aria-label="Files">
          {group && <p className="search-group-title quick-open-group" aria-hidden="true">{group}</p>}
          {options.map((option, position) => {
            const selected = option === active
            const row = {
              id: optionID(option),
              active: selected,
              "aria-selected": selected,
              onClick: () => choose(option),
              onMouseMove: selected ? undefined : () => setActiveIndex(position),
            }
            if (option.kind === "line") {
              const { name } = splitPath(lineTarget)
              return (
                <ListRow key={option.key} {...row} data-quick-open={option.key} density="pick" role="option"
                  className="quick-open-option" aria-label={`Go to line ${option.line} in ${name}`}>
                  <CornerDownRightIcon className="quick-open-icon" aria-hidden="true" />
                  <span className="quick-open-label">
                    <span className="quick-open-title">Go to line {option.line}</span>
                    <span className="quick-open-folder">{name}</span>
                  </span>
                </ListRow>
              )
            }
            const { directory, name } = splitPath(option.path)
            const lineNote = option.line ? `line ${option.line}` : ""
            return (
              <ListRow key={option.key} {...row} data-quick-open={option.key} density="pick" role="option"
                className="quick-open-option" title={option.path}
                aria-label={[name, directory, lineNote].filter(Boolean).join(", ")}>
                <FileIcon path={option.path} />
                <span className="quick-open-label">
                  <span className="quick-open-name"><Highlighted text={name} ranges={option.name} /></span>
                  {directory && <span className="quick-open-folder"><Highlighted text={directory} ranges={option.directory} /></span>}
                </span>
                {lineNote && <span className="quick-open-line">{lineNote}</span>}
              </ListRow>
            )
          })}
        </div>
      </div>
    </DialogShell>
  )
}
