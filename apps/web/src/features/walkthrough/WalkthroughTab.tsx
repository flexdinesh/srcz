import { CircleCheckIcon } from "lucide-react"
import { useMemo, type ReactNode } from "react"

import { Button } from "../../components/ui/button.tsx"
import { StatusMessage } from "../../components/ui/notice.tsx"
import type { WalkthroughSummary } from "@srcz/contracts"
import { DocumentPreview } from "../documents/DocumentPreview.tsx"
import { commitAge, commitDate, type CompareContext } from "../source-control/compare.ts"
import type { WalkthroughDetail } from "./use-walkthroughs.ts"
import { stepLabel, stepTarget, type StepPosition } from "./walkthrough-steps.ts"

interface WalkthroughTabProps {
  detail: WalkthroughDetail
  // position is the route's step, null for the cover.
  position: StepPosition
  context: CompareContext
  // note is a note step's narration; the tab shows it alone (decision 0113).
  note: ReactNode
  visited: ReadonlySet<number>
  // resume is where an unfinished walkthrough was left, or null.
  resume: StepPosition
  finished: boolean
  // justFinished shows the completion card above the cover.
  justFinished: boolean
  // nextUnread is the newest other walkthrough not yet opened.
  nextUnread: WalkthroughSummary | null
  onGoTo(position: StepPosition): void
  onOpen(id: string): void
  onShowList(): void
  onRetry(): void
  navigate(href: string): void
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`
}

// WalkthroughTab is a walkthrough's own tab (decision 0047): its cover (the
// title, summary, and outline), or a note step on its own page. Finishing
// leads the cover with a completion card (decision 0113).
export function WalkthroughTab(props: WalkthroughTabProps) {
  const { context, detail, finished, justFinished, navigate, nextUnread, note, onGoTo, onOpen, onRetry, onShowList, position, resume, visited } = props
  const updatedAt = detail.kind === "ready" ? detail.walkthrough.updatedAt : ""
  const now = useMemo(() => updatedAt ? Date.now() : 0, [updatedAt])
  if (detail.kind === "missing") {
    return (
      <div className="empty">
        <h1>Walkthrough unavailable</h1>
        <p>It was deleted, or another project published it.</p>
      </div>
    )
  }
  if (detail.kind === "error") {
    return (
      <div className="error" role="alert">
        <p>{detail.message}</p>
        <Button variant="outline" onClick={onRetry}>Try again</Button>
      </div>
    )
  }
  if (detail.kind !== "ready") return <StatusMessage>Loading walkthrough…</StatusMessage>
  const { walkthrough } = detail
  if (note && position !== null) {
    return (
      <div className="walkthrough-tab walkthrough-note">
        {note}
        <Button variant="link" size="inline" className="walkthrough-note-overview" onClick={() => onGoTo(null)}>
          {walkthrough.title}: overview
        </Button>
      </div>
    )
  }
  const count = walkthrough.steps.length
  const read = visited.size
  return (
    <div className="walkthrough-tab">
      {justFinished && (
        <section className="walkthrough-done" aria-labelledby="walkthrough-done-title" role="status">
          <CircleCheckIcon className="walkthrough-done-icon" aria-hidden="true" />
          <div className="walkthrough-done-text">
            <h2 id="walkthrough-done-title" className="walkthrough-done-title">You finished this walkthrough</h2>
            <p className="walkthrough-done-meta">{plural(read, "step")} of {count.toLocaleString()} read</p>
          </div>
          <div className="walkthrough-done-actions">
            {nextUnread && <Button onClick={() => onOpen(nextUnread.id)}>Next: {nextUnread.title}</Button>}
            <Button variant="outline" onClick={onShowList}>All walkthroughs</Button>
          </div>
        </section>
      )}
      <header className="walkthrough-cover">
        <p className="walkthrough-cover-meta" title={`Updated ${commitDate(walkthrough.updatedAt)}`}>
          Walkthrough · {plural(count, "step")} · updated {commitAge(walkthrough.updatedAt, now).long}
          {finished ? " · finished" : read > 0 ? ` · ${read.toLocaleString()} read` : ""}
        </p>
        <h1 className="walkthrough-cover-title">{walkthrough.title}</h1>
      </header>
      {walkthrough.summaryHTML && <DocumentPreview html={walkthrough.summaryHTML} navigate={navigate} />}
      {position === null && count > 0 && !justFinished && (
        <div className="walkthrough-start">
          {resume !== null
            ? <>
              <Button onClick={() => onGoTo(resume)}>Resume at step {(resume + 1).toLocaleString()}</Button>
              <Button variant="outline" onClick={() => onGoTo(0)}>Start over</Button>
            </>
            : <Button onClick={() => onGoTo(0)}>{finished ? "Read again" : "Start walkthrough"}</Button>}
        </div>
      )}
      <nav aria-label="Steps" className="walkthrough-outline">
        <ol>
          {walkthrough.steps.map((step, index) => {
            const target = stepTarget(step)
            return (
              <li key={index} data-current={index === position || undefined} data-visited={visited.has(index) || undefined}>
                <Button variant="link" size="inline" aria-current={index === position ? "step" : undefined}
                  aria-label={visited.has(index) ? `${step.title} (read)` : undefined}
                  onClick={() => onGoTo(index)}>{step.title}</Button>
                {target.kind !== "note" && <span className="walkthrough-outline-label">{stepLabel(step, context)}</span>}
              </li>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}
