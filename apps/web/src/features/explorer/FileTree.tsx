import type { FileTree as FileTreeModel, GitStatusEntry } from "@pierre/trees"
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react"
import { ChevronDownIcon, FoldVerticalIcon, FunnelIcon, GitBranchIcon, GitForkIcon, SearchIcon, UnfoldVerticalIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"

import { FilenameFilter, useFilenameFilter, type FilenameFilterState } from "./FilenameFilter.tsx"
import { countFiles, filterTreeByFilename } from "./filename-filter.ts"

import type { PageData, TreeNode } from "@zero/contracts"

import { openDirectoryPaths } from "../../api/page-data.ts"
import { projectShortcutLabel } from "../projects/ProjectPicker.tsx"
import { Button } from "../../components/ui/button.tsx"
import { treeCSS } from "../../lib/tree-css.ts"
import { treeIcons } from "../../lib/tree-icons.ts"
import { writeClipboard } from "../../lib/clipboard.ts"
import { desktopBridge } from "../../lib/desktop-bridge.ts"
import { absolutePath, isTreeMenuAction, treeMenuItems, treeRowPath, type TreeMenuAction } from "./tree-menu.ts"
import { TreeRowMenu } from "./TreeRowMenu.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import { treeRowHeight } from "../../components/ui/tree-rows.ts"
import { useSettings } from "../../settings/SettingsProvider.tsx"
import { uiScale } from "../../settings/settings.ts"
import { projectMemory, readMemory, rememberExpanded, restoreExpanded, updateMemory } from "../../workspace/workspace-memory.ts"

const mac = typeof navigator !== "undefined" && navigator.platform.includes("Mac")

function treePaths(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => node.isDir
    ? [`${node.path}/`, ...treePaths(node.children)]
    : [node.path])
}

interface FileTreeProps {
  // gitStatus decorates changed files; entries outside the tree are ignored.
  gitStatus: readonly GitStatusEntry[]
  hasData: boolean
  onNavigate(path: string): void
  onOpenProjects(): void
  // onOpenWorktrees lists the current repository's worktrees.
  onOpenWorktrees(): void
  page: PageData
  // open reveals the Explorer.
  registerOpen(open: (() => void) | null): void
  // onFindFile opens Quick Open (decision 0145).
  onFindFile(): void
  // onReveal shows the Explorer view, opening the mobile drawer.
  onReveal(): void
  // onDismiss closes the mobile drawer after a file opens.
  onDismiss(): void
  // onShowHistory filters Source Control's commits to a file (decision 0114).
  onShowHistory(path: string): void
}

interface ExplorerState {
  model: FileTreeModel | null
  expanded: string[] | null
}

export function FileTree(props: FileTreeProps) {
  const filter = useFilenameFilter()
  const page = useRef(props.page)
  const [rememberedExpanded] = useState(() => restoreExpanded(
    projectMemory(readMemory(), props.page.project),
    new Set(treePaths(props.page.tree).filter((path) => path.endsWith("/"))),
  ))
  const state = useRef<ExplorerState>({ model: null, expanded: rememberedExpanded ?? null })
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 48rem)").matches)
  const scale = uiScale(useSettings().settings)
  const [rowScale, setRowScale] = useState(scale)
  useLayoutEffect(() => { page.current = props.page }, [props.page])
  // saveState keeps expansion across an Explorer remount.
  const saveState = useCallback(() => {
    const model = state.current.model
    if (!model) return
    const expanded = new Set(state.current.expanded)
    for (const path of treePaths(page.current.tree)) {
      const item = model.getItem(path)
      if (item && "isExpanded" in item) {
        if (item.isExpanded()) expanded.add(path)
        else expanded.delete(path)
      }
    }
    state.current.expanded = [...expanded]
  }, [])
  // Pierre fixes row height at creation, so a font size change remounts it.
  useEffect(() => {
    if (scale === rowScale) return
    saveState()
    setRowScale(scale)
  }, [rowScale, saveState, scale])
  useEffect(() => {
    const query = window.matchMedia("(max-width: 48rem)")
    const update = () => {
      saveState()
      setMobile(query.matches)
    }
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [saveState])

  const itemHeight = treeRowHeight(mobile, rowScale)
  return <Explorer {...props} key={`${mobile ? "mobile" : "desktop"}-${itemHeight}`} mobile={mobile}
    itemHeight={itemHeight} filter={filter} state={state} />
}

function Explorer({ gitStatus, hasData, onFindFile, onNavigate, onOpenProjects, onOpenWorktrees, onReveal, onDismiss, onShowHistory, page, registerOpen, mobile, itemHeight, state, filter }: FileTreeProps & {
  mobile: boolean
  itemHeight: number
  filter: FilenameFilterState
  state: RefObject<ExplorerState>
}) {
  const visibleTree = useMemo(() => filterTreeByFilename(page.tree, filter.matcher), [page.tree, filter.matcher])
  const totalCount = useMemo(() => countFiles(page.tree), [page.tree])
  const visibleCount = useMemo(() => countFiles(visibleTree), [visibleTree])
  const paths = useMemo(() => treePaths(visibleTree), [visibleTree])
  const directoryPaths = useMemo(() => treePaths(page.tree).filter((path) => path.endsWith("/")), [page.tree])
  const directories = useMemo(() => new Set(directoryPaths), [directoryPaths])
  const expandedPaths = useRef(new Set(state.current.expanded ?? openDirectoryPaths(page.tree).map((path) => `${path}/`)))
  const rememberedExpanded = useRef<readonly string[] | null>(null)
  const [hasExpanded, setHasExpanded] = useState(expandedPaths.current.size > 0)
  const previousPaths = useRef(paths)
  // A snapshot (page.at) selects no working-tree file.
  const selectedFile = page.at ? "" : page.selected
  const previousSelected = useRef(selectedFile)
  const filterShelfId = useId()
  const filterInput = useRef<HTMLInputElement>(null)
  const filterButton = useRef<HTMLButtonElement>(null)
  const syncing = useRef(false)
  const current = useRef({ onNavigate, onDismiss, onShowHistory, page })
  // runMenuAction runs a row menu's action on a project-relative path.
  const runMenuAction = useCallback((action: TreeMenuAction, path: string, reveal?: (project: string, path: string) => void) => {
    const { page: shown, onShowHistory: showHistory } = current.current
    const project = shown.project
    if (!project) return
    if (action === "file-history") showHistory(path)
    else if (action === "reveal") reveal?.(project, path)
    else writeClipboard(action === "copy-path" ? absolutePath(project, path) : path).catch(() => undefined)
  }, [])
  // The desktop app gives rows a native menu with Reveal (decision 0081);
  // browsers render the same items on the themed menu (decision 0114).
  const [rowMenu] = useState(() => {
    const bridge = desktopBridge()
    const show = bridge?.showContextMenu ?? null
    const reveal = bridge?.revealPath ?? null
    return show && reveal ? { show, reveal } : null
  })
  const { model } = useFileTree({
    ...(rowMenu ? {
      composition: {
        // Right-click and the context-menu keys open it (Pierre's default).
        contextMenu: {
          onOpen(item: { kind: "directory" | "file"; path: string }, context: { anchorRect: { x: number; y: number }; close(options?: { restoreFocus?: boolean }): void }) {
            const path = treeRowPath(item.path)
            void rowMenu.show(treeMenuItems({ file: item.kind === "file", reveal: true }), context.anchorRect.x, context.anchorRect.y).then((id) => {
              context.close({ restoreFocus: id !== "file-history" })
              if (isTreeMenuAction(id)) runMenuAction(id, path, rowMenu.reveal)
            })
          },
        },
      },
    } : {}),
    paths,
    initialExpandedPaths: state.current.expanded ?? openDirectoryPaths(page.tree),
    itemHeight,
    initialSelectedPaths: paths.includes(selectedFile) ? [selectedFile] : [],
    density: "compact",
    search: false,
    unsafeCSS: treeCSS,
    icons: treeIcons,
    onSelectionChange(selected) {
      if (syncing.current) return
      const focused = model.getFocusedPath()
      const path = focused && selected.includes(focused) ? focused : selected.at(-1)
      if (!path || model.getItem(path)?.isDirectory()) return
      current.current.onDismiss()
      if (path !== current.current.page.selected || current.current.page.at) current.current.onNavigate(path)
    },
  })
  const syncExpandedPaths = useCallback(() => {
    for (const path of directoryPaths) {
      const item = model.getItem(path)
      if (item && "isExpanded" in item) {
        if (item.isExpanded()) expandedPaths.current.add(path)
        else expandedPaths.current.delete(path)
      }
    }
    const expanded = [...expandedPaths.current].filter((path) => directories.has(path))
    const previous = rememberedExpanded.current
    state.current.expanded = expanded
    if (hasData && !page.error && page.project && (previous === null
      || expanded.length !== previous.length || expanded.some((path, index) => path !== previous[index]))) {
      updateMemory((memory) => rememberExpanded(memory, page.project, expanded))
      rememberedExpanded.current = expanded
    }
    setHasExpanded(directoryPaths.some((path) => expandedPaths.current.has(path)))
  }, [directories, directoryPaths, hasData, model, page.error, page.project, state])

  useLayoutEffect(() => { current.current = { onNavigate, onDismiss, onShowHistory, page } }, [onDismiss, onNavigate, onShowHistory, page])

  useLayoutEffect(() => { state.current.model = model }, [model, state])

  // Only paths the tree shows carry a decoration; Source Control lists the rest.
  const shownPaths = useMemo(() => new Set(paths), [paths])
  useLayoutEffect(() => {
    model.setGitStatus(gitStatus.filter((entry) => shownPaths.has(entry.path)))
  }, [gitStatus, model, shownPaths])

  useLayoutEffect(() => {
    syncing.current = true
    const changed = paths.length !== previousPaths.current.length
      || paths.some((path, index) => path !== previousPaths.current[index])
    if (changed) {
      for (const path of previousPaths.current) {
        const item = model.getItem(path)
        if (item && "isExpanded" in item) {
          if (item.isExpanded()) expandedPaths.current.add(path)
          else expandedPaths.current.delete(path)
        }
      }
      state.current.expanded = [...expandedPaths.current]
      model.resetPaths(paths, { initialExpandedPaths: state.current.expanded })
      previousPaths.current = paths
    }
    for (const path of model.getSelectedPaths()) {
      if (path !== selectedFile) model.getItem(path)?.deselect()
    }
    if (selectedFile && model.getItem(selectedFile)) {
      if (selectedFile !== previousSelected.current) {
        const segments = selectedFile.split("/")
        for (let index = 1; index < segments.length; index++) {
          const item = model.getItem(segments.slice(0, index).join("/"))
          if (item && "expand" in item) item.expand()
        }
        model.scrollToPath(selectedFile, { focus: false })
      }
      model.getItem(selectedFile)?.select()
    }
    previousSelected.current = selectedFile
    syncing.current = false
    syncExpandedPaths()
  }, [model, selectedFile, paths, state, syncExpandedPaths])

  useLayoutEffect(() => model.subscribe(() => {
    if (syncing.current) return
    syncExpandedPaths()
  }), [model, syncExpandedPaths])

  const toggleDirectories = () => {
    const expand = !hasExpanded
    syncing.current = true
    for (const path of directoryPaths) {
      if (expand) expandedPaths.current.add(path)
      else expandedPaths.current.delete(path)
      const item = model.getItem(path)
      if (item && "expand" in item) {
        if (expand) item.expand()
        else item.collapse()
      }
    }
    syncing.current = false
    syncExpandedPaths()
  }

  const focusFirstRow = () => {
    const first = model.getVisibleRows(0, 0)[0]
    if (!first) return
    model.scrollToPath(first.path)
    requestAnimationFrame(() => {
      const row = model.getFileTreeContainer()?.shadowRoot
        ?.querySelector(`[role="treeitem"][data-item-path="${CSS.escape(first.path)}"]`)
      if (row instanceof HTMLElement) row.focus()
    })
  }

  useEffect(() => {
    registerOpen(onReveal)
    return () => registerOpen(null)
  }, [onReveal, registerOpen])

  // The filename filter row shows on demand; hiding it keeps the filter
  // applied, and the funnel's dot says so (decision 0145).
  const filterActive = filter.matcher !== null
  const toggleFilter = () => {
    const shown = !filter.shown
    filter.setShown(shown)
    if (shown) requestAnimationFrame(() => filterInput.current?.focus())
  }
  const hideFilter = () => {
    filter.setShown(false)
    filterButton.current?.focus()
  }

  // A linked worktree shows a colored fork; other checkouts show a branch.
  const projectName = page.repository || page.rootName || page.project
  const branchIcon = page.projectKind === "worktree"
    ? <GitForkIcon className="worktree-icon" aria-hidden="true" />
    : <GitBranchIcon aria-hidden="true" />

  return (
    <aside className="file-explorer" aria-label="Files">
      <div className="explorer-header">
        <Button variant="ghost" size="sm" className="project-trigger" aria-haspopup="dialog"
          aria-label={`Switch project (${projectName || "none"})`}
          aria-keyshortcuts="Control+O Meta+O" title={`Switch project (${projectShortcutLabel})`} onClick={onOpenProjects}>
          <span>{projectName || "Files"}</span>
          <ChevronDownIcon aria-hidden="true" />
        </Button>
        {page.branch && (page.worktrees > 1
          ? (
            <Button variant="ghost" size="sm" className="project-branch" aria-haspopup="dialog"
              aria-label={`Switch worktree (${page.branch})`} title={`Switch worktree (${page.branch})`} onClick={onOpenWorktrees}>
              {branchIcon}
              <span>{page.branch}</span>
            </Button>
          )
          : (
            <span className="project-branch" title={`${page.projectKind === "worktree" ? "Worktree" : "Branch"} ${page.branch}`}>
              {branchIcon}
              <span>{page.branch}</span>
            </span>
          ))}
        <IconButton label="Search files" aria-haspopup="dialog" aria-keyshortcuts="Control+P Meta+P"
          title={`Search files (${mac ? "⌘P" : "Ctrl+P"})`}
          icon={<SearchIcon aria-hidden="true" />} onClick={onFindFile} />
        <IconButton ref={filterButton} label="Filter files by name" aria-pressed={filter.shown} aria-controls={filterShelfId}
          indicator={filterActive && !filter.shown}
          title={filterActive && !filter.shown ? `Filter files by name (filtering: ${filter.applied})` : "Filter files by name"}
          disabled={!hasData || page.projectUnavailable}
          icon={<FunnelIcon aria-hidden="true" />} onClick={toggleFilter} />
        <IconButton label={hasExpanded ? "Collapse all folders" : "Expand all folders"}
          disabled={!hasData || directoryPaths.length === 0}
          icon={hasExpanded ? <FoldVerticalIcon aria-hidden="true" /> : <UnfoldVerticalIcon aria-hidden="true" />}
          onClick={toggleDirectories} />
        {mobile && <IconButton label="Close files" icon={<XIcon aria-hidden="true" />} onClick={onDismiss} />}
      </div>
      <div className="explorer-shelf" id={filterShelfId} hidden={!filter.shown || !hasData || page.projectUnavailable}>
        <FilenameFilter filter={filter} inputRef={filterInput}
          totalCount={totalCount} visibleCount={visibleCount} onFocusTree={focusFirstRow} onHide={hideFilter} />
      </div>
      {!hasData ? <p className="muted">Loading files…</p>
        : page.projectUnavailable ? <p className="muted">{page.project ? "Project unavailable." : "No folder is open."}</p>
        : page.error ? <p className="muted">{page.errorCode === "privacyBlocked" || page.errorCode === "folderUnreadable" ? "Can't read this folder." : "Files unavailable."}</p>
        : page.empty ? <p className="muted">No files found.</p>
        : paths.length === 0 ? <p className="muted explorer-empty">
          No files match <code>{filter.applied}</code>
          <Button variant="outline" className="explorer-empty-action" onClick={filter.clear}>Clear filter</Button>
        </p>
        : <>
          <PierreFileTree model={model} className="file-tree-host" aria-label="Files"
            renderContextMenu={rowMenu ? undefined : (item, context) => (
              <TreeRowMenu anchor={context.anchorElement} name={item.name}
                items={treeMenuItems({ file: item.kind === "file", reveal: false })}
                onAction={(action) => runMenuAction(action, treeRowPath(item.path))}
                onClose={(restoreFocus) => context.close({ restoreFocus })} />
            )}
            onClick={() => {
            const focused = model.getFocusedPath()
            if (focused && !model.getItem(focused)?.isDirectory() && model.getSelectedPaths().includes(focused)) onDismiss()
          }} />
        </>}
      {page.warnings.length > 0 && (
        <details className="warnings">
          <summary>Some paths could not be read</summary>
          <ul>{page.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      )}
    </aside>
  )

}
