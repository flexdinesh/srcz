import { Menu } from "@base-ui/react/menu"
import { CheckIcon, ChevronUpIcon, CircleCheckIcon, CircleDotIcon, CircleSlashIcon, EllipsisIcon, MessageSquareTextIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react"

import { Button } from "../../components/ui/button.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../../components/ui/menu.ts"
import { StatusMessage } from "../../components/ui/notice.tsx"
import { TextArea } from "../../components/ui/text-field.tsx"
import type { Feedback, FeedbackStatus, FeedbackThread } from "@zero/contracts"
import { useClipboardCopy } from "../../lib/clipboard.ts"
import { DocumentPreview } from "../documents/DocumentPreview.tsx"
import { commitAge, commitDate } from "../source-control/compare.ts"
import { readDraft, replyKey, writeDraft } from "./feedback-drafts.ts"
import {
  authorLabel, isClosed, lastAuthor, noLanguage, placeLabel, statusChange, statusLabels, threadPrompt, threadTitle,
} from "./feedback-model.ts"
import { markFeedbackSeen } from "./use-feedback-seen.ts"
import type { FeedbackSession } from "./use-feedback.ts"

const mac = typeof navigator !== "undefined" && navigator.platform.includes("Mac")
// sendKeys names Cmd/Ctrl+Enter, which sends a comment or reply.
export const sendKeys = mac ? "⌘↵" : "Ctrl+Enter"

// Presses inside a zone stay out of the code around it, which selects lines
// and navigates names, as a walkthrough's narration does.
export function stopZoneEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

export const zoneEvents = { onPointerDown: stopZoneEvent, onMouseDown: stopZoneEvent, onClick: stopZoneEvent, onPointerOver: stopZoneEvent }

// isSendKey is Cmd/Ctrl+Enter.
export function isSendKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing
}

// FeedbackStatusIcon marks a thread's status beside its label: never color
// alone.
export function FeedbackStatusIcon({ status, className }: { status: FeedbackStatus; className?: string }) {
  const Icon = status === "resolved" ? CircleCheckIcon : status === "wontfix" ? CircleSlashIcon : CircleDotIcon
  return <Icon className={className} data-status={status} aria-hidden="true" />
}

function CopyThread({ text }: { text(): string }) {
  const { status, copy } = useClipboardCopy()
  const icon = status === "copied" ? <CheckIcon aria-hidden="true" /> : status === "failed" ? <XIcon aria-hidden="true" /> : <MessageSquareTextIcon aria-hidden="true" />
  return (
    <>
      <IconButton label="Copy Thread for Agent" title={status === "failed" ? "Copy failed" : "Copy Thread for Agent"}
        tone={status === "copied" ? "success" : status === "failed" ? "destructive" : "default"} data-status={status} icon={icon}
        onClick={() => { void copy(text()) }} />
      <span className="visually-hidden" role="status">{status === "copied" ? "Thread copied for an agent" : status === "failed" ? "Copy failed" : ""}</span>
    </>
  )
}

export interface FeedbackThreadZoneProps {
  thread: FeedbackThread
  feedback: Feedback
  session: FeedbackSession
  navigate(href: string): void
  // before shows above the conversation, e.g. an outdated thread's text.
  before?: ReactNode
}

// FeedbackThreadZone is a thread as an editor zone (decision 0120): a band
// in the code it is about, in the walkthrough narration's treatment, with
// the conversation and a reply field. Closed threads collapse to one line.
// Showing a thread expanded marks its agent reply seen.
export function FeedbackThreadZone({ before, feedback, navigate, session, thread }: FeedbackThreadZoneProps) {
  const closed = isClosed(thread.status)
  const [expandedAt, setExpandedAt] = useState<string | null>(null)
  // A closed thread stays expanded only for the version the user opened.
  const expanded = !closed || expandedAt === thread.updatedAt
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const draftKey = replyKey(feedback.project, feedback.id, thread.number)
  const [reply, setReply] = useState(() => readDraft(draftKey))
  const field = useRef<HTMLTextAreaElement>(null)
  const id = feedback.id

  useEffect(() => {
    if (expanded && thread.awaiting === "user") markFeedbackSeen(id, [thread])
  }, [expanded, id, thread])

  const updateReply = (text: string) => {
    setReply(text)
    writeDraft(draftKey, text)
  }

  const send = (status?: FeedbackStatus) => {
    const body = reply.trim()
    if (busy || (!body && !status)) return
    setBusy(true)
    setError("")
    session.reply(thread.number, body, status).then(() => {
      updateReply("")
      if (status && isClosed(status)) setExpandedAt(null)
    }, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Couldn't send the reply.")
    }).finally(() => setBusy(false))
  }

  const remove = () => {
    setError("")
    session.removeThread(thread.number).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Couldn't delete the thread.")
    })
  }

  const label = statusLabels[thread.status]
  const place = placeLabel(thread)
  if (!expanded) {
    return (
      <section className="feedback-thread" data-status={thread.status} data-collapsed aria-label={`Thread ${thread.number}: ${label}, ${place}`} {...zoneEvents}>
        <Button variant="plain" size="inline" className="feedback-thread-summary" aria-expanded={false}
          title={`Thread ${thread.number} · ${label} · ${place}`} onClick={() => setExpandedAt(thread.updatedAt)}>
          <FeedbackStatusIcon status={thread.status} className="feedback-status-icon" />
          <span className="visually-hidden">{label}: </span>
          <span className="feedback-thread-summary-title">{threadTitle(thread)}</span>
          <span className="feedback-thread-summary-author">{lastAuthor(thread)}</span>
        </Button>
      </section>
    )
  }

  return (
    <section className="feedback-thread" data-status={thread.status} aria-label={`Thread ${thread.number}: ${label}, ${place}`} {...zoneEvents}>
      <header className="feedback-thread-header">
        <span className="feedback-thread-status" data-status={thread.status}>
          <FeedbackStatusIcon status={thread.status} className="feedback-status-icon" />{label}
        </span>
        <span className="feedback-thread-number">Thread {thread.number}</span>
        <span className="feedback-thread-place" title={place}>{place}</span>
        <div className="feedback-thread-actions">
          <CopyThread text={() => threadPrompt(feedback, thread, noLanguage)} />
          <Button size="sm" variant="ghost" disabled={busy || !id} onClick={() => send(closed ? "open" : "resolved")}>
            {closed ? "Reopen" : "Resolve"}
          </Button>
          <Menu.Root>
            <Menu.Trigger render={<IconButton label="More Thread Actions" icon={<EllipsisIcon aria-hidden="true" />} />} />
            <Menu.Portal>
              <Menu.Positioner className={menuPositionerClass} sideOffset={4} align="end">
                <Menu.Popup className={menuPopupClass} aria-label="Thread actions">
                  {thread.status !== "wontfix" && <Menu.Item className={menuItemClass} disabled={!id} onClick={() => send("wontfix")}>Won't fix</Menu.Item>}
                  <Menu.Item className={menuItemClass} disabled={!id} onClick={remove}>Delete thread</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          {closed && <IconButton label="Collapse Thread" icon={<ChevronUpIcon aria-hidden="true" />} onClick={() => setExpandedAt(null)} />}
        </div>
      </header>
      {before}
      <Messages thread={thread} navigate={navigate} />
      <div className="feedback-reply" data-open={reply ? true : undefined}>
        <TextArea ref={field} className="feedback-reply-field" rows={1} value={reply} placeholder="Reply…" aria-label={`Reply to thread ${thread.number}`}
          aria-keyshortcuts="Control+Enter Meta+Enter" disabled={busy}
          onChange={(event) => updateReply(event.target.value)}
          onKeyDown={(event) => {
            if (isSendKey(event)) {
              event.preventDefault()
              send()
            } else if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              field.current?.blur()
            }
          }} />
        <div className="feedback-reply-footer">
          <span className="feedback-hint">Markdown · {sendKeys} to send</span>
          <Button size="sm" disabled={busy || !reply.trim() || !id} onClick={() => send()}>Reply</Button>
        </div>
      </div>
      {error && <StatusMessage tone="error" role="alert" className="feedback-error">{error}</StatusMessage>}
    </section>
  )
}

function Messages({ navigate, thread }: { thread: FeedbackThread; navigate(href: string): void }) {
  const now = useMemo(() => thread.updatedAt ? Date.now() : 0, [thread.updatedAt])
  return (
    <ol className="feedback-messages">
      {thread.messages.map((message) => (
        <li key={message.number} className="feedback-message" data-author={message.author}>
          <p className="feedback-message-meta">
            <span className="feedback-message-author">{authorLabel(message)}</span>
            <time dateTime={message.createdAt} title={commitDate(message.createdAt)}>{commitAge(message.createdAt, now).long}</time>
          </p>
          {message.bodyHTML && <div className="feedback-message-body"><DocumentPreview html={message.bodyHTML} navigate={navigate} /></div>}
          {message.status && <p className="feedback-message-status">{statusChange(message.status)}</p>}
        </li>
      ))}
    </ol>
  )
}
