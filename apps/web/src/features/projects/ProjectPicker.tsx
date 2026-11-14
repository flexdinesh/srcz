import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  GitBranchIcon,
  GitForkIcon,
  XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"

import { Button } from "../../components/ui/button.tsx"
import { DialogShell } from "../../components/ui/dialog-shell.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import { Kbd } from "../../components/ui/kbd.tsx"
import { ListRow } from "../../components/ui/list-row.tsx"
import { TextField } from "../../components/ui/text-field.tsx"
import { isAbort } from "../../api/http.ts"
import {
  browseRows,
  browseStart,
  browseTarget,
  canDrill,
  currentGroup,
  groupName,
  hostParentInput,
  offersOpenFolder,
  parentInput,
  projectSections,
  selectableRows,
  splitBrowseInput,
  splitHostInput,
  visibleWarnings,
  within,
  withSlash,
  type PickerRow,
  type PickerSection,
} from "./project-picker.ts"
import type { DirectoriesResponse, ProjectsResponse } from "@zero/contracts"
import { fetchDirectories, fetchProjects, openRoot, removeRoot, takeLandingPick } from "../../api/projects-data.ts"
import { useDelayedFlag } from "../../lib/use-delayed-flag.ts"
import { forgetProject, readMemory, rememberedProjects, updateMemory } from "../../workspace/workspace-memory.ts"

type Load<T> =
  | { kind: "loading"; previous: T | null }
  | { kind: "ready"; value: T }
  | { kind: "error"; message: string; previous: T | null }

export interface PickerOpenOptions {
  // worktrees opens on the current project's repository worktrees.
  worktrees?: boolean
  // browse opens on Open folder…'s folder browser (decision 0146).
  browse?: boolean
}

interface ProjectPickerProps {
  project: string
  registerOpen(open: ((options?: PickerOpenOptions) => void) | null): void
  onOpen(project: string): void
}

const noRoots: readonly string[] = []

export const projectShortcutLabel = typeof navigator !== "undefined" && navigator.platform.includes("Mac") ? "⌘O" : "Ctrl+O"

function loaded<T>(load: Load<T> | null): T | null {
  if (!load) return null
  return load.kind === "ready" ? load.value : load.previous
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// ProjectPicker is a quick pick: Projects lists served folders, discovered
// repositories (each opening into its worktrees), and opened folders; Browse
// walks folders that are not inside a repository: anywhere on the host when
// its server manages roots, opening one serves it (decision 0146), else
// under the served roots.
export function ProjectPicker({ project, registerOpen, onOpen }: ProjectPickerProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const controller = useRef<AbortController | null>(null)
  const directoryCache = useRef(new Map<string, Load<DirectoriesResponse>>())
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"projects" | "browse">("projects")
  const [query, setQuery] = useState("")
  // group is the repository whose worktrees are listed; "" lists projects.
  const [group, setGroup] = useState("")
  // followCurrent lists the current project's worktrees once projects load.
  const [followCurrent, setFollowCurrent] = useState(false)
  const [path, setPath] = useState("")
  const [projects, setProjects] = useState<Load<ProjectsResponse> | null>(null)
  const [directories, setDirectories] = useState<ReadonlyMap<string, Load<DirectoriesResponse>>>(() => new Map())
  const [memoryVersion, setMemoryVersion] = useState(0)
  const [activeKey, setActiveKey] = useState("")
  // change is a served-folder change in flight or its failure.
  const [change, setChange] = useState<{ kind: "busy"; text: string } | { kind: "error"; text: string } | null>(null)
  const changeController = useRef<AbortController | null>(null)

  // enterBrowse starts Browse: the host's home where the server manages
  // roots, else the served roots.
  const enterBrowse = useCallback((value: ProjectsResponse | null) => {
    setMode("browse")
    setPath(value?.manageRoots === true ? "" : browseStart(value?.roots.map((root) => root.path) ?? noRoots))
    setActiveKey("")
    setChange(null)
    input.current?.focus()
  }, [])

  // loadProjects reads projects; browse enters Browse once they load
  // (PickerOpenOptions.browse).
  const loadProjects = useCallback((browse = false) => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setProjects((current) => ({ kind: "loading", previous: loaded(current) }))
    fetchProjects(next.signal).then(
      (value) => {
        setProjects({ kind: "ready", value })
        if (browse) enterBrowse(value)
      },
      (error: unknown) => {
        if (isAbort(error)) return
        setProjects((current) => ({ kind: "error", message: errorMessage(error, "Couldn't list projects."), previous: loaded(current) }))
      },
    )
  }, [enterBrowse])

  const show = useCallback((options?: PickerOpenOptions) => {
    const element = dialog.current
    if (!element) return
    if (!element.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      element.showModal()
    }
    directoryCache.current = new Map()
    setDirectories(new Map())
    setMode("projects")
    setQuery("")
    setGroup("")
    setFollowCurrent(options?.worktrees === true)
    setChange(null)
    setPath("")
    setActiveKey("")
    // Re-read memory: projects opened since mount changed it.
    setMemoryVersion((version) => version + 1)
    setOpen(true)
    loadProjects(options?.browse === true)
    input.current?.focus()
  }, [loadProjects])

  const close = useCallback(() => {
    controller.current?.abort()
    changeController.current?.abort()
    if (dialog.current?.open) dialog.current.close()
    setOpen(false)
    returnFocus.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    registerOpen(show)
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== "o") return
      event.preventDefault()
      show()
    }
    document.addEventListener("keydown", shortcut)
    if (takeLandingPick()) show()
    return () => {
      registerOpen(null)
      document.removeEventListener("keydown", shortcut)
      controller.current?.abort()
    }
  }, [registerOpen, show])

  const projectList = loaded(projects)
  const roots = useMemo(() => projectList?.roots.map((root) => root.path) ?? noRoots, [projectList])
  // host browses anywhere on the server's host (decision 0146).
  const host = projectList?.manageRoots === true
  const { folder, partial } = host ? splitHostInput(path) : splitBrowseInput(path, roots)
  useEffect(() => {
    if (!open || mode !== "browse" || directoryCache.current.has(folder)) return
    const store = (load: Load<DirectoriesResponse>) => {
      directoryCache.current.set(folder, load)
      setDirectories(new Map(directoryCache.current))
    }
    const abort = new AbortController()
    store({ kind: "loading", previous: null })
    fetchDirectories(folder, abort.signal).then(
      (value) => {
        // An empty host path lists the home folder: cache it under its path
        // before storing, so typing it in finds the listing, then type it in.
        if (host && folder === "") directoryCache.current.set(value.path, { kind: "ready", value })
        store({ kind: "ready", value })
        if (host && folder === "") setPath((current) => current === "" ? withSlash(value.path) : current)
      },
      (error: unknown) => {
        if (isAbort(error)) {
          directoryCache.current.delete(folder)
          return
        }
        store({ kind: "error", message: errorMessage(error, "Could not read that folder."), previous: null })
      },
    )
    return () => abort.abort()
  }, [folder, host, mode, open])

  // Read on render so a forgotten folder (memoryVersion) disappears at once.
  const remembered = useMemo(() => memoryVersion >= 0 ? rememberedProjects(readMemory()) : [], [memoryVersion])
  const listedGroup = followCurrent ? projectList ? currentGroup(projectList, project) : "" : group
  const folderLoad = directories.get(folder) ?? null
  const openFolderOffered = mode === "projects" && projectList !== null && offersOpenFolder(projectList)
  const sections: PickerSection[] = useMemo(() => {
    if (mode === "browse") return browseRows(folder, partial, loaded(folderLoad)?.directories ?? [], host)
    if (openFolderOffered) return []
    return projectList ? projectSections(projectList, remembered, project, query, listedGroup) : []
  }, [folder, folderLoad, host, listedGroup, mode, openFolderOffered, partial, project, projectList, query, remembered])
  const rows = useMemo(() => selectableRows(sections), [sections])
  const active = rows.find((row) => row.key === activeKey) ?? rows[0]
  const scanning = useDelayedFlag(open && mode === "projects" && projects?.kind === "loading", 150)
  const listing = useDelayedFlag(open && mode === "browse" && folderLoad?.kind === "loading", 150)

  useEffect(() => {
    if (!active) return
    list.current?.querySelector(`[data-key="${CSS.escape(active.key)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  function openProject(id: string) {
    close()
    if (id !== project) onOpen(id)
  }

  // serveFolder asks the server to serve a folder on its host, then opens
  // its project; a refusal stays in the picker (decision 0146).
  function serveFolder(folderPath: string) {
    changeController.current?.abort()
    const abort = new AbortController()
    changeController.current = abort
    setChange({ kind: "busy", text: "Opening folder…" })
    openRoot(folderPath, abort.signal).then(
      (opened) => {
        setChange(null)
        close()
        if (opened.project !== project) onOpen(opened.project)
      },
      (error: unknown) => {
        if (isAbort(error)) return
        setChange({ kind: "error", text: errorMessage(error, "Couldn't open the folder.") })
        input.current?.focus()
      },
    )
  }

  // stopServing stops serving a root. Leaving the current project's root
  // lands on the next served project, or none (decision 0146).
  function stopServing(root: string) {
    changeController.current?.abort()
    const abort = new AbortController()
    changeController.current = abort
    setChange({ kind: "busy", text: "Stopping…" })
    removeRoot(root, abort.signal).then(
      () => {
        setChange(null)
        if (within(project, root)) {
          close()
          onOpen("")
          return
        }
        loadProjects()
        input.current?.focus()
      },
      (error: unknown) => {
        if (isAbort(error)) return
        setChange({ kind: "error", text: errorMessage(error, "Couldn't stop serving the folder.") })
        input.current?.focus()
      },
    )
  }

  // openFolder opens a folder the browser chose: a host folder is served
  // first; a folder under the roots opens as its project.
  function openFolder(folderPath: string) {
    if (host) serveFolder(folderPath)
    else openProject(folderPath)
  }

  const startBrowse = useCallback(() => enterBrowse(projectList), [enterBrowse, projectList])

  // listGroup lists a repository's worktrees, or projects again for "".
  function listGroup(next: string) {
    setFollowCurrent(false)
    setGroup(next)
    setQuery("")
    setActiveKey("")
    input.current?.focus()
  }

  function activate(row: PickerRow | undefined) {
    if (!row) return
    switch (row.kind) {
      case "project":
        if (!row.disabled) openProject(row.id)
        return
      case "browse":
        startBrowse()
        return
      case "open":
        openFolder(row.path)
        return
      case "directory":
        if (row.isProject) {
          openFolder(row.path)
          return
        }
        setPath(`${row.path}/`)
        setActiveKey("")
        input.current?.focus()
    }
  }

  function forget(id: string) {
    updateMemory((memory) => forgetProject(memory, id))
    setMemoryVersion((version) => version + 1)
    input.current?.focus()
  }

  function changeInput(value: string) {
    setActiveKey("")
    if (change?.kind === "error") setChange(null)
    if (mode === "projects") {
      if (!query && !listedGroup && (value === "/" || value === "./")) {
        startBrowse()
        return
      }
      setQuery(value)
      return
    }
    setPath(value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!rows.length) return
      const index = active ? rows.indexOf(active) : -1
      const step = event.key === "ArrowDown" ? 1 : -1
      setActiveKey(rows[(index + step + rows.length) % rows.length]?.key ?? "")
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (!active && openFolderOffered) startBrowse()
      else activate(active)
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
    } else if (mode === "projects" && !listedGroup && canDrill(active)
      && (event.key === "Tab" || (event.key === "ArrowRight" && event.currentTarget.selectionStart === query.length))) {
      event.preventDefault()
      listGroup(active.group)
    } else if (mode === "projects" && listedGroup && query === "" && (event.key === "Backspace" || event.key === "ArrowLeft")) {
      event.preventDefault()
      listGroup("")
    } else if (event.key === "Tab" && mode === "browse") {
      const target = browseTarget(rows, active)
      if (!target) return
      event.preventDefault()
      setPath(`${target.path}/`)
      setActiveKey("")
    } else if (event.key === "Backspace" && mode === "browse" && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      if (path === "") {
        event.preventDefault()
        setMode("projects")
        setActiveKey("")
      } else if (path.endsWith("/") && event.currentTarget.selectionStart === path.length) {
        event.preventDefault()
        setPath(host ? hostParentInput(path) : parentInput(path, roots))
        setActiveKey("")
      }
    }
  }

  const status = change
    ? { tone: change.kind === "error" ? "error" : "muted", text: change.text }
    : mode === "projects"
    ? projects?.kind === "error"
      ? { tone: "error", text: projects.message }
      : scanning
        ? { tone: "muted", text: "Scanning for projects…" }
        : openFolderOffered
          ? { tone: "empty", text: "No projects yet." }
          : projectList && query.trim() && !sections.some((section) => section.title)
            ? { tone: "muted", text: listedGroup ? `No worktrees match “${query.trim()}”.` : `No projects match “${query.trim()}”.` }
            : null
    : folderLoad?.kind === "error"
      ? { tone: "error", text: folderLoad.message }
      : listing
        ? { tone: "muted", text: "Reading folder…" }
        : folderLoad?.kind === "ready" && !sections.some((section) => section.title)
          ? { tone: "muted", text: partial ? `No folders match “${partial}”.` : "No folders here." }
          : null
  const listedName = listedGroup && projectList ? groupName(projectList, listedGroup) : ""
  const label = mode === "browse" ? "Folder path" : listedGroup ? `Switch ${listedName} worktree` : "Switch project"
  const warnings = mode === "projects" && projectList ? visibleWarnings(projectList) : []
  const activeID = active ? `project-option-${active.key}` : undefined

  return (
    <DialogShell
      ref={dialog}
      variant="palette"
      backdrop="transparent"
      className="search-dialog project-dialog"
      aria-labelledby="project-picker-title"
      onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => { if (event.target === dialog.current) close() }}
    >
      <div className="search-shell">
        <h2 id="project-picker-title" className="visually-hidden">
          {mode === "projects" ? "Switch project" : "Open folder"}
        </h2>
        <TextField
          variant="palette"
          icon={mode === "browse" ? <FolderSearchIcon aria-hidden="true" /> : listedGroup ? <GitBranchIcon aria-hidden="true" /> : <FolderGit2Icon aria-hidden="true" />}
          leading={mode === "projects" && listedGroup && (
            <Button variant="ghost" size="sm" className="project-prefix project-back" title="Back to projects (Backspace)"
              aria-label="Back to projects" onClick={() => listGroup("")}>
              <ChevronLeftIcon aria-hidden="true" />{listedName}
            </Button>
          )}
          trailing={<Kbd>Esc</Kbd>}
          inputRef={input}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={mode === "browse" ? "Type a folder path" : listedGroup ? "Filter worktrees" : "Switch project, → for worktrees, / to browse"}
          aria-label={label}
          role="combobox"
          aria-controls="project-results"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-activedescendant={activeID}
          value={mode === "projects" ? query : path}
          onChange={(event) => changeInput(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {(status || warnings.length > 0) && (
          <div className={`search-status project-status${status?.tone === "error" ? " search-status-error" : ""}`} role="status" aria-live="polite">
            {status && <span>{status.text}</span>}
            {status?.tone === "error" && mode === "projects" && !change && (
              <Button variant="outline" onClick={() => loadProjects()}>Retry</Button>
            )}
            {status?.tone === "empty" && <Button variant="outline" onClick={startBrowse}>Open folder…</Button>}
            {!status && warnings.length > 0 && (
              <span title={warnings.join("\n")}>
                {warnings.length === 1 ? "1 folder couldn't be read." : `${warnings.length} folders couldn't be read.`}
              </span>
            )}
          </div>
        )}
        <div ref={list} id="project-results" className="search-results project-results" role="listbox"
          aria-label={mode === "browse" ? "Folders" : listedGroup ? "Worktrees" : "Projects"}>
          {sections.map((section, sectionIndex) => (
            <div key={section.title || `actions-${sectionIndex}`} role="group" aria-label={section.title || undefined}
              className={section.title ? "project-group" : "project-group project-actions"}>
              {section.title && <h3 className="project-group-title" aria-hidden="true">{section.title}</h3>}
              {section.rows.map((row) => (
                <PickerOption key={row.key} row={row} active={row === active}
                  onActivate={() => activate(row)}
                  onHover={() => setActiveKey(row.key)}
                  onDrill={canDrill(row) ? () => listGroup(row.group) : undefined}
                  onForget={row.kind === "project" && row.projectKind === "opened" && !row.current ? () => forget(row.id) : undefined}
                  onStopServing={host && row.kind === "project" && row.servedRoot && change?.kind !== "busy" ? () => stopServing(row.servedRoot) : undefined} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </DialogShell>
  )
}

interface PickerOptionProps {
  row: PickerRow
  active: boolean
  onActivate(): void
  onHover(): void
  onDrill?(): void
  onForget?(): void
  onStopServing?(): void
}

function PickerOption({ row, active, onActivate, onHover, onDrill, onForget, onStopServing }: PickerOptionProps) {
  const disabled = row.kind === "project" && row.disabled
  return (
    <div className={onDrill ? "project-option-row drillable" : "project-option-row"} data-key={row.key}>
      <ListRow
        id={`project-option-${row.key}`}
        density="pick"
        active={active}
        className={disabled ? "project-option disabled" : "project-option"}
        role="option"
        aria-selected={active}
        aria-disabled={disabled || undefined}
        onClick={onActivate}
        onMouseMove={disabled || active ? undefined : onHover}
      >
        <OptionIcon row={row} />
        <OptionText row={row} />
      </ListRow>
      {onDrill && row.kind === "project" && (
        <IconButton size="xs" className="project-drill" tabIndex={-1}
          label={`Show ${row.name} worktrees`} title="Show worktrees (→)" icon={<ChevronRightIcon aria-hidden="true" />}
          onClick={onDrill} />
      )}
      {onForget && (
        <IconButton size="xs" className="project-forget" tabIndex={-1}
          label={`Forget ${row.kind === "project" ? row.path : ""}`} title="Remove from opened folders"
          icon={<XIcon aria-hidden="true" />} onClick={onForget} />
      )}
      {onStopServing && row.kind === "project" && (
        <IconButton size="xs" className="project-forget project-stop" tabIndex={-1}
          label={`Stop serving ${row.path}`} title="Stop serving this folder"
          icon={<FolderMinusIcon aria-hidden="true" />} onClick={onStopServing} />
      )}
    </div>
  )
}

// OptionIcon and OptionText draw a row's icon and text; Welcome's project
// list shares them.
export function OptionIcon({ row }: { row: PickerRow }) {
  switch (row.kind) {
    case "browse": return <FolderSearchIcon aria-hidden="true" />
    case "open": return <CornerDownLeftIcon aria-hidden="true" />
    case "directory": return row.isProject ? <FolderGit2Icon aria-hidden="true" /> : <FolderIcon aria-hidden="true" />
    case "project":
      switch (row.projectKind) {
        case "repo": return <FolderGit2Icon aria-hidden="true" />
        case "worktree": return <GitForkIcon className="worktree-icon" aria-hidden="true" />
        case "opened": return <FolderOpenIcon aria-hidden="true" />
        case "folder": return <FolderIcon aria-hidden="true" />
      }
  }
}

// OptionPath truncates from the start so the deepest folders stay visible.
function OptionPath({ path, title = path }: { path: string; title?: string }) {
  return <span className="project-option-path project-option-path-tail" title={title}><span dir="ltr">{path}</span></span>
}

export function OptionText({ row }: { row: PickerRow }) {
  switch (row.kind) {
    case "browse":
      return <>
        <span className="project-option-name">Open folder…</span>
        <span className="project-option-grow" />
        <kbd className="project-option-meta">/</kbd>
      </>
    case "open":
      return <>
        <span className="project-option-name">Open</span>
        <OptionPath path={`${row.path}/`} />
      </>
    case "directory":
      return <>
        <span className="project-option-name">{row.name}</span>
        <span className="project-option-grow" />
        {row.problem
          ? <span className="project-option-meta project-option-problem" title={row.problem}>{row.note}</span>
          : row.isProject && <span className="project-option-meta">git · opens whole</span>}
      </>
    case "project":
      return <>
        {row.repository && row.projectKind !== "opened" && <span className="project-option-meta">{row.repository} ›</span>}
        <span className="project-option-name">{row.name}</span>
        {row.branch && row.branch !== row.name && <span className="project-option-branch">{row.branch}</span>}
        {row.location
          ? row.location !== row.name && <OptionPath path={row.location} title={row.path} />
          : <span className="project-option-path" title={row.path}>served folder</span>}
        <span className="project-option-grow" />
        {row.disabled && <span className={row.problem ? "project-option-meta project-option-problem" : "project-option-meta"} title={row.problem || undefined}>{row.note}</span>}
        {row.worktrees > 1 && <span className="project-option-meta">{row.worktrees} worktrees</span>}
        {row.current && <span className="project-option-current"><CheckIcon aria-hidden="true" />Current</span>}
      </>
  }
}
