import { Menu } from "@base-ui/react/menu"
import { CheckIcon, ChevronDownIcon, ClipboardCopyIcon, EllipsisIcon, GitBranchIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { FileIcon } from "../../components/FileIcon.tsx"
import { Button } from "../../components/ui/button.tsx"
import { CopyButton } from "../../components/ui/copy-button.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import { ListRow } from "../../components/ui/list-row.tsx"
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../../components/ui/menu.ts"
import { Notice, StatusMessage } from "../../components/ui/notice.tsx"
import { SegmentedControl, SegmentedItem } from "../../components/ui/segmented-control.tsx"
import { ViewHeader } from "../../components/ui/view-header.tsx"
import type { Feedback, FeedbackThread } from "@zero/contracts"
import { useClipboardCopy } from "../../lib/clipboard.ts"
import { shareableOrigin } from "../../lib/shareable-origin.ts"
import { useRovingRows } from "../../lib/use-roving-rows.ts"
import { commitAge, commitDate } from "../source-control/compare.ts"
import {
  activity, branchLabel, feedbackMarkdown, feedbackMeta, feedbackPrompt, filterChoices, groupByFile, isUnseen, matchesFilter, noLanguage,
  placeLabel, statusLabels, threadRoute, threadTitle, type ThreadRoute,
} from "./feedback-model.ts"
import { FeedbackStatusIcon, FeedbackThreadZone } from "./FeedbackThreadZone.tsx"
import type { FeedbackViewState } from "./use-feedback-view.ts"

interface FeedbackViewProps {
  // project is the absolute path the copied prompt names.
  project: string
  // branch is the checkout's branch, "" when detached.
  branch: string
  view: FeedbackViewState
  mobile: boolean
  onDismiss(): void
  onOpenThread(route: ThreadRoute): void
  navigate(href: string): void
}

const emptyHint = "Select lines in a diff or file and press C to comment. Then copy the prompt for your agent."

function copyIcon(status: "idle" | "copied" | "failed") {
  return status === "copied" ? <CheckIcon aria-hidden="true" /> : status === "failed" ? <XIcon aria-hidden="true" /> : <ClipboardCopyIcon aria-hidden="true" />
}

// CopyPrompt copies the prompt that sends an agent to the threads waiting
// on it: an icon in the view header, or a labeled button in the empty view.
function CopyPrompt({ feedback, project, labeled = false }: { feedback: Feedback | null; project: string; labeled?: boolean }) {
  const { status, copy } = useClipboardCopy()
  const id = feedback && feedback.threads.length > 0 ? feedback.id : ""
  const onClick = () => {
    if (feedback && id) void copy(feedbackPrompt({ origin: shareableOrigin(window.location.origin), project, id, branch: feedback.branch }))
  }
  const reason = id ? undefined : "Comment on code first"
  return (
    <>
      {labeled
        ? <Button variant="outline" data-status={status} disabled={!id} title={reason} onClick={onClick}>
          {copyIcon(status)}{status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy prompt"}
        </Button>
        : <IconButton label="Copy Prompt" title={status === "failed" ? "Copy failed" : "Copy Prompt: send your agent to these threads"}
          disabledReason={reason} tone={status === "copied" ? "success" : status === "failed" ? "destructive" : "default"} data-status={status}
          icon={copyIcon(status)} onClick={onClick} />}
      <span className="visually-hidden" role="status">{status === "copied" ? "Prompt copied" : status === "failed" ? "Copy failed" : ""}</span>
    </>
  )
}

// BranchPicker chooses whose feedback the view shows: the checkout's branch
// by default, or any branch with feedback in the repository.
function BranchPicker({ branch: checkout, view }: { branch: string; view: FeedbackViewState }) {
  // The checkout's feedback names its branch once read.
  const branch = view.selectedId === "" && view.session.feedback ? view.session.feedback.branch : checkout
  const entries = view.list.result ?? []
  const current = entries.find((entry) => entry.branch === branch)
  const others = entries.filter((entry) => entry !== current)
  const value = view.selectedId === "" || view.selectedId === current?.id ? "" : view.selectedId
  const shown = value === "" ? branch : view.session.feedback?.branch ?? others.find((entry) => entry.id === value)?.branch ?? ""
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button variant="ghost" size="sm" className="feedback-branch" aria-label={`Branch: ${branchLabel(shown)}`} />}>
        <GitBranchIcon aria-hidden="true" />
        <span className="feedback-branch-name" data-detached={shown ? undefined : true}>{branchLabel(shown)}</span>
        <ChevronDownIcon aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className={menuPositionerClass} sideOffset={4} align="start">
          <Menu.Popup className={menuPopupClass} aria-label="Feedback branches">
            <Menu.RadioGroup value={value} onValueChange={(next: unknown) => {
              if (typeof next === "string") view.show(next)
            }}>
              {[{ id: "", branch, current: true }, ...others.map((entry) => ({ id: entry.id, branch: entry.branch, current: false }))].map((choice) => {
                const summary = choice.current ? current : entries.find((entry) => entry.id === choice.id)
                return (
                  <Menu.RadioItem key={choice.id || "current"} className={menuItemClass} value={choice.id}>
                    <Menu.RadioItemIndicator className="feedback-branch-check" keepMounted>
                      <CheckIcon aria-hidden="true" />
                    </Menu.RadioItemIndicator>
                    <span className="feedback-branch-name" data-detached={choice.branch ? undefined : true}>{branchLabel(choice.branch)}</span>
                    {summary && <span className="feedback-branch-detail">{summary.open.toLocaleString()} open</span>}
                  </Menu.RadioItem>
                )
              })}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

// FeedbackView is the Feedback activity (decision 0120): one branch's
// threads grouped by file, filtered by status, with the prompt that sends
// an agent to them. A thread opens where it was written; an outdated one
// opens in place with the text it was about.
export function FeedbackView({ branch, mobile, navigate, onDismiss, onOpenThread, project, view }: FeedbackViewProps) {
  const { session } = view
  const feedback = session.feedback
  const [confirming, setConfirming] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const markdown = useClipboardCopy()
  const shownThreads = useMemo(() => (feedback?.threads ?? [])
    .filter((thread) => matchesFilter(thread, view.filter) && (!view.path || thread.location.path === view.path)), [feedback, view.filter, view.path])
  const remove = () => {
    setDeleteError("")
    session.removeFeedback().then(() => {
      setConfirming(false)
      view.show("")
    }, (error: unknown) => setDeleteError(error instanceof Error ? error.message : "Couldn't delete the feedback."))
  }
  const hasThreads = (feedback?.threads.length ?? 0) > 0
  return (
    <div className="feedback-view">
      <ViewHeader className="explorer-header sidebar-header" title="Feedback" actions={<>
        <CopyPrompt feedback={feedback} project={project} />
        <Menu.Root>
          <Menu.Trigger render={<IconButton label="More Feedback Actions" tone={markdown.status === "copied" ? "success" : "default"}
            icon={markdown.status === "copied" ? <CheckIcon aria-hidden="true" /> : <EllipsisIcon aria-hidden="true" />} />} />
          <Menu.Portal>
            <Menu.Positioner className={menuPositionerClass} sideOffset={4} align="end">
              <Menu.Popup className={menuPopupClass} aria-label="Feedback actions">
                <Menu.Item className={menuItemClass} disabled={!feedback || shownThreads.length === 0}
                  onClick={() => { if (feedback) void markdown.copy(feedbackMarkdown(feedback, shownThreads, noLanguage)) }}>
                  Copy as Markdown
                </Menu.Item>
                <Menu.Separator className={menuSeparatorClass} />
                <Menu.Item className={menuItemClass} disabled={!feedback?.id} onClick={() => setConfirming(true)}>Delete feedback</Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <span className="visually-hidden" role="status">{markdown.status === "copied" ? "Threads copied as Markdown" : markdown.status === "failed" ? "Copy failed" : ""}</span>
        {mobile && <IconButton label="Close feedback" icon={<XIcon aria-hidden="true" />} onClick={onDismiss} />}
      </>} />
      <div className="feedback-scroll">
        <div className="feedback-heading">
          <BranchPicker branch={branch} view={view} />
          {feedback?.id && (
            <p className="feedback-meta">
              <code className="feedback-id">{feedback.id}</code>
              <CopyButton text={feedback.id} label={`Copy feedback id ${feedback.id}`} className="feedback-id-copy" />
              <span className="feedback-meta-counts">{feedbackMeta(feedback, view.unseen)}</span>
            </p>
          )}
        </div>
        {confirming && (
          <Notice tone="warning" layout="bar" role="group" aria-label="Delete feedback" className="feedback-confirm">
            <span>Delete every thread on {branchLabel(feedback?.branch ?? "")}? Zero keeps no copy.</span>
            {deleteError && <span role="alert">{deleteError}</span>}
            <span className="feedback-confirm-actions">
              <Button size="sm" variant="destructive" onClick={remove}>Delete</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            </span>
          </Notice>
        )}
        {hasThreads && (
          <SegmentedControl size="sm" className="feedback-filter" aria-label="Show threads">
            {filterChoices.map((choice) => (
              <SegmentedItem key={choice.value} pressed={view.filter === choice.value} onClick={() => view.setFilter(choice.value)}>{choice.label}</SegmentedItem>
            ))}
          </SegmentedControl>
        )}
        {view.path && (
          <p className="feedback-narrowed">
            <span className="feedback-narrowed-label">Only <code>{view.path}</code></span>
            <IconButton size="xs" label="Show Every File" icon={<XIcon aria-hidden="true" />} onClick={view.clearPath} />
          </p>
        )}
        <FeedbackBody view={view} threads={shownThreads} project={project} navigate={navigate} onOpenThread={(route) => {
          onOpenThread(route)
          if (mobile) onDismiss()
        }} />
      </div>
    </div>
  )
}

interface BodyProps {
  view: FeedbackViewState
  threads: readonly FeedbackThread[]
  project: string
  navigate(href: string): void
  onOpenThread(route: ThreadRoute): void
}

function FeedbackBody({ navigate, onOpenThread, project, threads, view }: BodyProps) {
  const { load, feedback } = view.session
  if (load.kind === "missing") {
    return (
      <div className="feedback-note">
        <StatusMessage>This feedback was deleted.</StatusMessage>
        <Button variant="outline" onClick={() => view.show("")}>Show this branch's feedback</Button>
      </div>
    )
  }
  if (load.kind === "error" && !feedback) {
    return (
      <div className="feedback-note">
        <StatusMessage tone="error" role="alert">{load.message}</StatusMessage>
        <Button variant="outline" onClick={view.session.retry}>Retry</Button>
      </div>
    )
  }
  if (!feedback) return <div className="feedback-note"><StatusMessage>Loading feedback…</StatusMessage></div>
  if (feedback.threads.length === 0) {
    return (
      <div className="feedback-note">
        <StatusMessage>{emptyHint}</StatusMessage>
        <CopyPrompt feedback={feedback} project={project} labeled />
      </div>
    )
  }
  return <>
    {load.kind === "error" && <StatusMessage tone="error" role="alert" className="feedback-stale">{load.message}</StatusMessage>}
    {threads.length === 0
      ? <div className="feedback-note"><StatusMessage>{view.filter === "resolved" ? "No resolved threads." : view.filter === "awaiting" ? "Nothing awaits the agent." : "No open threads."}</StatusMessage></div>
      : <ThreadRows feedback={feedback} threads={threads} view={view} navigate={navigate} onOpenThread={onOpenThread} />}
  </>
}

interface RowsProps {
  feedback: Feedback
  threads: readonly FeedbackThread[]
  view: FeedbackViewState
  navigate(href: string): void
  onOpenThread(route: ThreadRoute): void
}

function ThreadRows({ feedback, navigate, onOpenThread, threads, view }: RowsProps) {
  const groups = useMemo(() => groupByFile(threads), [threads])
  const ordered = useMemo(() => groups.flatMap((group) => group.threads), [groups])
  const [expanded, setExpanded] = useState<number | null>(null)
  const now = useMemo(() => feedback.updatedAt ? Date.now() : 0, [feedback.updatedAt])
  const open = (index: number) => {
    const thread = ordered[index]
    if (!thread) return
    const route = threadRoute(feedback.project, thread)
    if (route) onOpenThread(route)
    else setExpanded((current) => current === thread.number ? null : thread.number)
  }
  const { container, tabIndex, setFocused, onKeyDown } = useRovingRows(ordered.length, -1, open)
  return (
    <div ref={container} className="feedback-rows" role="listbox" aria-label="Threads"
      onKeyDown={(event) => {
        // Keys inside an expanded thread belong to its controls.
        if (event.target instanceof Element && event.target.closest(".feedback-thread")) return
        onKeyDown(event)
      }}>
      {groups.map((group) => (
        <div key={group.path} role="group" aria-label={group.path} className="feedback-group">
          <div className="feedback-group-header" aria-hidden="true">
            <FileIcon path={group.path} />
            <span className="feedback-group-path" title={group.path}>{group.path}</span>
          </div>
          {group.threads.map((thread) => {
            const index = ordered.indexOf(thread)
            const outdated = thread.location.state === "outdated"
            const fresh = isUnseen(view.seen, feedback.id, thread)
            const last = thread.messages.at(-1)
            const age = last ? commitAge(last.createdAt, now).long : ""
            const title = threadTitle(thread)
            const detail = `${placeLabel(thread)} · ${activity(thread)} ${age}`
            return [
              <ListRow key={thread.number} role="option" aria-selected={false} tabIndex={index === tabIndex ? 0 : -1}
                className="feedback-row" data-new={fresh || undefined} aria-expanded={outdated ? expanded === thread.number : undefined}
                title={`Thread ${thread.number}: ${title}\n${detail}${last ? `\n${commitDate(last.createdAt)}` : ""}`}
                aria-label={`Thread ${thread.number}, ${statusLabels[thread.status]}${fresh ? ", new reply" : ""}: ${title}, ${detail}${outdated ? ", outdated" : ""}`}
                onFocus={() => setFocused(index)} onClick={() => open(index)}>
                <FeedbackStatusIcon status={thread.status} className="feedback-row-icon feedback-status-icon" />
                <span className="feedback-row-text">
                  <span className="feedback-row-title">{title}</span>
                  <span className="feedback-row-meta">
                    {detail}{outdated && <span className="feedback-row-outdated"> · outdated</span>}
                  </span>
                </span>
                {fresh && <span className="feedback-row-new" title="New reply" aria-hidden="true" />}
              </ListRow>,
              outdated && expanded === thread.number && (
                <div key={`${thread.number}-thread`} className="feedback-inline">
                  <FeedbackThreadZone thread={thread} feedback={feedback} session={view.session} navigate={navigate}
                    before={thread.anchor.text && thread.anchor.text.length > 0
                      ? <pre className="feedback-original" aria-label="The code this thread was about">{thread.anchor.text.join("\n")}</pre>
                      : undefined} />
                </div>
              ),
            ]
          })}
        </div>
      ))}
    </div>
  )
}
