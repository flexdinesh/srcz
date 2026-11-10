import { useEffect, useRef, useState } from "react"

import { Button } from "../../components/ui/button.tsx"
import { StatusMessage } from "../../components/ui/notice.tsx"
import { TextArea } from "../../components/ui/text-field.tsx"
import { readDraft, writeDraft } from "./feedback-drafts.ts"
import { anchorKey, anchorLabel, type FeedbackAnchorInput } from "./feedback-model.ts"
import { isSendKey, sendKeys, zoneEvents } from "./FeedbackThreadZone.tsx"

export interface FeedbackComposerProps {
  anchor: FeedbackAnchorInput
  // onSubmit starts the thread; a rejection shows its message and keeps the
  // text.
  onSubmit(body: string): Promise<void>
  onCancel(): void
}

// FeedbackComposer starts a thread at an anchor (decision 0120): a zone at
// the selection's last line, or under a file's band for the whole file. The
// text survives Cancel for the same anchor until the page reloads.
export function FeedbackComposer({ anchor, onCancel, onSubmit }: FeedbackComposerProps) {
  const key = anchorKey(anchor)
  const [text, setText] = useState(() => readDraft(key))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => field.current?.focus({ preventScroll: true }), [])

  const update = (next: string) => {
    setText(next)
    writeDraft(key, next)
  }
  const submit = () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError("")
    onSubmit(body).then(() => writeDraft(key, ""), (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Couldn't add the comment.")
      setBusy(false)
    })
  }
  const label = anchorLabel(anchor)

  return (
    <section className="feedback-thread feedback-composer" aria-label={`New comment on ${label}`} {...zoneEvents}>
      <header className="feedback-thread-header">
        <span className="feedback-thread-number">New comment</span>
        <span className="feedback-thread-place" title={label}>{label}</span>
      </header>
      <TextArea ref={field} className="feedback-composer-field" rows={3} value={text} placeholder="Leave a comment for the agent"
        aria-label={`Comment on ${label}`} aria-keyshortcuts="Control+Enter Meta+Enter Escape" disabled={busy}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (isSendKey(event)) {
            event.preventDefault()
            submit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }} />
      <div className="feedback-reply-footer">
        <span className="feedback-hint">Markdown · {sendKeys} to comment</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={busy || !text.trim()} onClick={submit}>Comment</Button>
      </div>
      {error && <StatusMessage tone="error" role="alert" className="feedback-error">{error}</StatusMessage>}
    </section>
  )
}
