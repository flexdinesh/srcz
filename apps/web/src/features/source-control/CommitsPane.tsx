import { ChevronsDownIcon, FileDiffIcon, GitBranchIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"

import { Button } from "../../components/ui/button.tsx"
import { CopyButton } from "../../components/ui/copy-button.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import { ListButton, ListRow } from "../../components/ui/list-row.tsx"
import { StatusMessage } from "../../components/ui/notice.tsx"
import { Chevron } from "../../components/ui/section-toggle.tsx"
import { TextField } from "../../components/ui/text-field.tsx"
import { FileIcon } from "../../components/FileIcon.tsx"
import type { Commit } from "@zero/contracts"
import { shortHash } from "../../lib/commit-hash.ts"
import { useClipboardCopy } from "../../lib/clipboard.ts"
import { emptyHistoryMessage, filterAnnouncement, isFiltered, moreLabel } from "./commit-filter.ts"
import { commitAge, commitDate, selectedHashes, selectionCompare, type Compare } from "./compare.ts"
import { statusLetters, type FileList } from "./compare-files.ts"
import { detailsFiles, diffGlyph, fileParts, moreFilesLabel, type RefChip } from "./source-control-panes.ts"
import type { CommitFilterState } from "./use-commit-filter.ts"
import type { Commits } from "./use-commits.ts"

// Long-pressing a commit on a phone starts a range; the next tap ends it.
const longPress = 500

interface CommitsPaneProps {
  commits: Commits
  // filter is the filter field's state (decisions 0114, 0129).
  filter: CommitFilterState
  // range is the Branch/All control, beside the field.
  range: ReactNode
  // lanes maps commits to their stack layer's lane (commitLanes).
  lanes: ReadonlyMap<string, number>
  // selection is the selected commit or range, null for none.
  selection: Compare | null
  // chips name the stack's branches at their commits.
  chips: ReadonlyMap<string, readonly RefChip[]>
  // allOnly is set when HEAD is the base branch: the list is all history.
  allOnly: boolean
  mobile: boolean
  onSelect(compare: Compare): void
  // onOpen opens a compare's review, at path when given; focusDocument moves
  // focus to it.
  onOpen(compare: Compare, focusDocument: boolean, path?: string): void
  onShowAll(): void
}

// CommitsPane lists the range's commits (decisions 0040, 0112). Click selects
// a commit and opens its diff, keeping focus; Shift-click extends a
// contiguous run and opens the range's diff. Arrows, Home/End, and Space
// only select; Enter opens the selection's diff and focuses it; Escape
// narrows a range. With a path filter, opening a commit opens its review at
// that file. The filter field and Branch/All head the pane (decision 0129).
export function CommitsPane({
  allOnly, chips, commits, filter, lanes, mobile, range, selection, onOpen, onSelect, onShowAll,
}: CommitsPaneProps) {
  const { error, files, loadFiles, loadMore, loadingMore, moreError, refresh, result } = commits
  // at is the file a path-filtered list opens reviews at.
  const at = result?.path || undefined
  const filterInput = useRef<HTMLInputElement>(null)
  const { focusPending, focused } = filter
  useEffect(() => {
    if (!focusPending || !filterInput.current) return
    filterInput.current.focus()
    focused()
  }, [focusPending, focused])
  const list = useMemo(() => result?.commits ?? [], [result])
  const selected = useMemo(() => selectedHashes(list, selection), [list, selection])
  const container = useRef<HTMLDivElement>(null)
  const [focusedKey, setFocusedKey] = useState("")
  // anchor is the commit a Shift-selection extends from: the last commit
  // selected without Shift.
  const [anchor, setAnchor] = useState("")
  // pending is a phone's long-pressed commit, waiting for a second tap.
  const [pending, setPending] = useState("")
  // expanded holds the commits whose details show; transient, not persisted.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const press = useRef<{ timer: number; hash: string; fired: boolean } | null>(null)
  const hashCopy = useClipboardCopy()
  const tabKey = list.some((commit) => commit.hash === focusedKey) ? focusedKey : selected[0] ?? list[0]?.hash ?? ""
  // now is read once per list so ages don't shift between renders.
  const now = useMemo(() => result ? Date.now() : 0, [result])
  // focusListOnLoad moves focus to the list's row once Escape's cleared
  // filter has reread it; the filtered rows unmount while it reloads.
  const focusListOnLoad = useRef(false)
  const unfiltered = result !== null && !isFiltered(result)
  useEffect(() => {
    if (!focusListOnLoad.current || !unfiltered || !tabKey) return
    focusListOnLoad.current = false
    const row = container.current?.querySelector(`[data-row-key="${CSS.escape(tabKey)}"]`)
    if (row instanceof HTMLElement) row.focus()
  }, [tabKey, unfiltered])

  function focusRow(hash: string) {
    setFocusedKey(hash)
    requestAnimationFrame(() => {
      const row = container.current?.querySelector(`[data-row-key="${CSS.escape(hash)}"]`)
      if (row instanceof HTMLElement) row.focus()
    })
  }

  // setDetails opens or closes a commit's details, dropping commits no longer
  // listed. Opening reads the commit's files, shared with its review.
  function setDetails(hash: string, open: boolean) {
    if (open) loadFiles(hash)
    setExpanded((current) => {
      const next = new Set([...current].filter((key) => key !== hash && list.some((commit) => commit.hash === key)))
      if (open) next.add(hash)
      return next
    })
  }

  // select selects a commit, or extends the range to it, and returns what it
  // selected.
  function select(hash: string, extend: boolean): Compare | null {
    const compare = selectionCompare(list, extend && anchor ? anchor : hash, hash)
    if (!extend) setAnchor(hash)
    if (compare) onSelect(compare)
    return compare
  }

  // open reviews what a row's diff glyph stands for.
  function open(hash: string, focusDocument: boolean) {
    const glyph = diffGlyph(hash, selection, selected)
    onOpen(glyph ? glyph.compare : { kind: "commit", hash }, focusDocument, at)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = list.findIndex((commit) => commit.hash === tabKey)
    const row = list[index]
    if (!row) return
    if ((event.key === "c" || event.key === "C") && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      void hashCopy.copy(row.hash)
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = list[index + (event.key === "ArrowDown" ? 1 : -1)]
      if (!next) return
      const extend = event.shiftKey && !mobile
      if (extend && !anchor) setAnchor(row.hash)
      focusRow(next.hash)
      if (extend) {
        const compare = selectionCompare(list, anchor || row.hash, next.hash)
        if (compare) onSelect(compare)
      } else {
        select(next.hash, false)
      }
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      setDetails(row.hash, event.key === "ArrowRight")
    } else if (event.key === "Home" || event.key === "End") {
      const next = event.key === "Home" ? list[0] : list.at(-1)
      if (!next) return
      focusRow(next.hash)
      select(next.hash, false)
    } else if (event.key === "Escape" && selection?.kind === "range") {
      // Escape narrows a range back to the commit it started from.
      select(anchor || selection.to, false)
    } else if (event.key === " ") {
      select(row.hash, event.shiftKey && !mobile)
    } else if (event.key === "Enter") {
      if (!selected.includes(row.hash)) {
        select(row.hash, false)
        onOpen({ kind: "commit", hash: row.hash }, true, at)
      } else {
        open(row.hash, true)
      }
    } else {
      return
    }
    event.preventDefault()
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>, hash: string) {
    if (!mobile || event.pointerType === "mouse") return
    const timer = window.setTimeout(() => {
      if (press.current?.hash !== hash) return
      press.current.fired = true
      setPending(hash)
      setAnchor(hash)
      onSelect({ kind: "commit", hash })
    }, longPress)
    press.current = { timer, hash, fired: false }
  }

  function endPress() {
    if (press.current) window.clearTimeout(press.current.timer)
  }

  function onClick(event: { shiftKey: boolean }, hash: string) {
    const pressed = press.current
    press.current = null
    if (pressed?.fired) return
    if (mobile && pending) {
      // The second tap ends a long-press range and opens it.
      const compare = selectionCompare(list, pending, hash)
      setPending("")
      if (compare) {
        onSelect(compare)
        onOpen(compare, false, at)
      }
      return
    }
    const compare = select(hash, event.shiftKey && !mobile)
    if (compare) onOpen(compare, false, at)
  }

  return (
    <div className="compare-list">
      <div className="scm-pane-actions commit-filter" role="search" aria-label="Filter commits"
        onKeyDown={(event) => {
          // Escape clears the query and path and returns to the list.
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          filter.clear()
          // A listed unfiltered page needs no reread.
          if (!unfiltered) focusListOnLoad.current = true
          else if (tabKey) focusRow(tabKey)
        }}>
        <TextField inputRef={filterInput} icon={<SearchIcon />} type="text" aria-label="Filter commits by message, author, or hash"
          placeholder="Filter commits" value={filter.filter.query} spellCheck={false} autoComplete="off" autoCapitalize="off"
          onChange={(event) => filter.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "Enter") return
            const first = list[0]
            if (!first) return
            event.preventDefault()
            focusRow(tabKey || first.hash)
          }}
          trailing={filter.filter.query && <IconButton size="xs" label="Clear query" icon={<XIcon aria-hidden="true" />}
            onClick={() => {
              filter.setQuery("")
              filterInput.current?.focus()
            }} />} />
        {range}
        {filter.filter.path && (
          <div className="commit-filter-path" title={`History of ${filter.filter.path}`}>
            <FileIcon path={filter.filter.path} />
            {/* Right-to-left flow truncates the start, keeping the file name. */}
            <span className="commit-filter-path-text"><span dir="ltr">{filter.filter.path}</span></span>
            <IconButton size="xs" label={`Remove path filter ${filter.filter.path}`} icon={<XIcon aria-hidden="true" />}
              onClick={() => {
                filter.clearPath()
                filterInput.current?.focus()
              }} />
          </div>
        )}
      </div>
      {error && <div className="source-control-message">
        <StatusMessage tone="error" role="alert">{error}</StatusMessage>
        {!result && <Button variant="outline" onClick={refresh}>Retry</Button>}
      </div>}
      {/* Load more ends the list and scrolls with it, as in VS Code. */}
      <div className="compare-scroll">
        <div ref={container} className="compare-rows" role="listbox" aria-label="Commits" aria-multiselectable={!mobile || undefined}
          onKeyDown={onKeyDown}>
          {list.map((commit) => <CommitRow key={commit.hash} commit={commit} now={now}
            selected={selected.includes(commit.hash)} inRange={selection?.kind === "range" && selected.includes(commit.hash)}
            pending={pending === commit.hash} focusable={commit.hash === tabKey} chips={chips.get(commit.hash) ?? []}
            lane={lanes.get(commit.hash)}
            expanded={expanded.has(commit.hash)} onExpandedChange={(open) => setDetails(commit.hash, open)}
            files={files.get(commit.hash)} onRetryFiles={() => loadFiles(commit.hash, true)}
            glyph={diffGlyph(commit.hash, selection, selected)}
            onFocus={() => setFocusedKey(commit.hash)}
            onPointerDown={(event) => onPointerDown(event, commit.hash)} onPointerEnd={endPress}
            onClick={(event) => onClick(event, commit.hash)}
            onOpenFile={(path) => onOpen({ kind: "commit", hash: commit.hash }, false, path || at)} />)}
        </div>
        {(result?.more || moreError) && (
          <div className="commit-more">
            {moreError && <StatusMessage className="commit-more-error" tone="error" role="alert">{moreError}</StatusMessage>}
            <ListButton density="list" className="compare-row commit-more-row" aria-disabled={loadingMore || undefined}
              onClick={() => { if (!loadingMore) loadMore() }}>
              {moreError ? <RefreshCwIcon className="compare-row-icon" aria-hidden="true" />
                : <ChevronsDownIcon className="compare-row-icon" aria-hidden="true" />}
              <span className="compare-row-label">{loadingMore ? "Loading…" : moreError ? "Retry" : result ? moreLabel(result) : "Load more"}</span>
            </ListButton>
          </div>
        )}
      </div>
      {result && list.length === 0 && (
        <div className="source-control-message">
          <StatusMessage>{emptyHistoryMessage(result)}</StatusMessage>
          {result.range === "branch" && !allOnly && <Button variant="outline" onClick={onShowAll}>Show all history</Button>}
        </div>
      )}
      {mobile && pending && <StatusMessage className="compare-list-hint" role="status">Tap another commit to compare a range.</StatusMessage>}
      <div className="visually-hidden" aria-live="polite">
        {hashCopy.status === "copied" ? "Commit hash copied." : hashCopy.status === "failed" ? "Couldn't copy the commit hash."
          : result ? filterAnnouncement(result) : ""}
      </div>
    </div>
  )
}

interface CommitRowProps {
  commit: Commit
  now: number
  selected: boolean
  inRange: boolean
  pending: boolean
  focusable: boolean
  chips: readonly RefChip[]
  // lane is the commit's stack layer lane, undefined outside the stack.
  lane: number | undefined
  glyph: ReturnType<typeof diffGlyph>
  expanded: boolean
  // files is the commit's file list, once its details asked for it.
  files: FileList | undefined
  onExpandedChange(expanded: boolean): void
  onRetryFiles(): void
  onFocus(): void
  onPointerDown(event: PointerEvent<HTMLDivElement>): void
  onPointerEnd(): void
  onClick(event: { shiftKey: boolean }): void
  onOpenFile(path: string): void
}

// CommitRow is one commit; its chevron (or Right and Left) shows details
// under it: message body, author, date, hash, the branches it tips, and its
// files.
function CommitRow({
  chips, commit, expanded, files, focusable, glyph, inRange, lane, now, pending, selected, onClick, onExpandedChange, onFocus, onOpenFile,
  onPointerDown, onPointerEnd, onRetryFiles,
}: CommitRowProps) {
  const age = commitAge(commit.authorTime, now)
  const detailsId = useId()
  return (<>
    <ListRow data-row-key={commit.hash} role="option" tabIndex={focusable ? 0 : -1} aria-selected={selected} selected={selected}
      className="compare-row compare-row-commit" data-range={inRange || undefined} data-pending={pending || undefined}
      data-diff-pinned={glyph?.pinned || undefined} data-expanded={expanded || undefined} data-lane={lane}
      aria-describedby={expanded ? detailsId : undefined}
      aria-label={`${commit.subject}, ${commit.author.name}, ${age.long}${chips.length ? `, ${chips.map((chip) => chip.name).join(", ")}` : ""}`}
      title={`${commit.subject}\n${commit.author.name} · ${commitDate(commit.authorTime)} · ${shortHash(commit.hash)}`}
      onFocus={onFocus} onPointerDown={onPointerDown} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onPointerLeave={onPointerEnd}
      onClick={onClick}>
      {/* The row keeps its own keyboard; Right and Left toggle the same details. */}
      <IconButton size="xs" variant="bare" className="commit-details-toggle" tabIndex={-1} aria-expanded={expanded}
        label={expanded ? "Hide commit details" : "Show commit details"} icon={<Chevron />}
        onClick={(event) => {
          event.stopPropagation()
          onExpandedChange(!expanded)
        }}
        onPointerDown={(event) => event.stopPropagation()} />
      {/* Two lines: the subject and the branches it tips, then author, age,
          and short hash. */}
      <span className="commit-row-text">
        <span className="commit-row-subject">
          <span className="compare-row-label">{commit.subject || "(no message)"}</span>
          {chips.map((chip) => <RefChipView key={chip.name} chip={chip} />)}
        </span>
        <span className="commit-row-meta">
          <span className="commit-row-author">{commit.author.name}</span>
          <span aria-hidden="true">·</span>
          <span className="commit-row-age">{age.long}</span>
          <span aria-hidden="true">·</span>
          <span className="commit-row-hash">{shortHash(commit.hash)}</span>
        </span>
      </span>
      {/* The glyph only signals that a click opens the diff; clicks reach the row. */}
      {glyph && <FileDiffIcon className="commit-diff-glyph" aria-hidden="true" />}
    </ListRow>
    {/* A listbox holds options only, so the row names these details through
        aria-describedby and they stay out of the accessibility tree. */}
    {expanded && (
      <div id={detailsId} className="commit-details" aria-hidden="true" data-lane={lane}>
        {commit.body && <p className="commit-details-body">{commit.body}</p>}
        <p className="commit-details-line"><span>{commit.author.name} &lt;{commit.author.email}&gt;</span></p>
        <p className="commit-details-line"><time dateTime={commit.authorTime}>{commitDate(commit.authorTime)}</time></p>
        <p className="commit-details-line">
          <code className="commit-compare-hash">{shortHash(commit.hash)}</code>
          <CopyButton text={commit.hash} label="Copy commit hash" tabIndex={-1} />
        </p>
        {chips.length > 0 && (
          <p className="commit-details-line">
            <GitBranchIcon className="commit-details-icon" />
            {chips.map((chip) => <RefChipView key={chip.name} chip={chip} />)}
          </p>
        )}
        <CommitFiles files={files} onRetry={onRetryFiles} onOpen={onOpenFile} />
      </div>
    )}
  </>)
}

// RefChipView is a branch name chip in its layer's lane.
function RefChipView({ chip }: { chip: RefChip }) {
  return <span className="ref-chip" data-lane={chip.lane} data-current={chip.current || undefined}>{chip.name}</span>
}

interface CommitFilesProps {
  files: FileList | undefined
  onRetry(): void
  // onOpen opens the commit's review at path, or at its start for "".
  onOpen(path: string): void
}

// CommitFiles lists a commit's first files in review order; the row after
// them opens the review. Pointer-only, as the details are: Enter opens the
// review, whose Files rail lists every file.
function CommitFiles({ files, onOpen, onRetry }: CommitFilesProps) {
  if (!files || files.kind === "loading") return <p className="commit-details-line">Reading files…</p>
  if (files.kind === "error") {
    return (
      <p className="commit-details-line commit-details-files-error">
        <span>Couldn't read files: {files.message}</span>
        <Button variant="outline" size="sm" tabIndex={-1} onClick={onRetry}>Retry</Button>
      </p>
    )
  }
  if (files.files.length === 0) return <p className="commit-details-line">No files changed.</p>
  const capped = detailsFiles(files.files, files.truncated)
  const more = moreFilesLabel(capped)
  return (
    <div className="commit-details-files">
      {capped.shown.map((file) => {
        const { name, folder } = fileParts(file.path)
        return (
          <ListRow key={file.path} className="changes-row commit-details-file" data-status={file.status}
            title={file.oldPath ? `${file.path}\nRenamed from ${file.oldPath}` : file.path}
            onClick={() => onOpen(file.path)}>
            <FileIcon path={file.path} />
            <span className="changes-row-name">{name}</span>
            <span className="changes-row-folder">{folder}</span>
            <span className="commit-file-status" data-status={file.status}>{statusLetters[file.status]}</span>
          </ListRow>
        )
      })}
      {more && (
        <ListRow className="changes-row commit-details-file commit-details-more" onClick={() => onOpen("")}>
          <span className="changes-row-folder">{more}</span>
        </ListRow>
      )}
    </div>
  )
}
