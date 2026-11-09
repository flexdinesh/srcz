import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, MessageSquareTextIcon, XIcon } from "lucide-react"
import type { SyntheticEvent } from "react"

import { Button } from "../../components/ui/button.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import { Notice } from "../../components/ui/notice.tsx"
import type { WalkthroughStep } from "@zero/contracts"
import { useClipboardCopy } from "../../lib/clipboard.ts"
import { DocumentPreview } from "../documents/DocumentPreview.tsx"
import { StepProgress } from "./StepProgress.tsx"
import type { StepCheck } from "./walkthrough-steps.ts"

const mac = typeof navigator !== "undefined" && navigator.platform.includes("Mac")
export const nextStepKeys = mac ? "⌘→" : "Ctrl+Right"
export const previousStepKeys = mac ? "⌘←" : "Ctrl+Left"

export interface NarrationProps {
  step: WalkthroughStep
  index: number
  count: number
  // visited are the steps read so far, for the progress line.
  visited: ReadonlySet<number>
  // check is whether the step's code changed since it was written, with the
  // line it expected and the line there now (decision 0113).
  check: StepCheck
  // controls shows Previous and Next (or Finish); the step bar carries them
  // while presenting and on phones.
  controls: boolean
  canMove(direction: 1 | -1): boolean
  onMove(direction: 1 | -1): void
  onFinish(): void
  onExit(): void
  // prompt is the text Copy for Agent copies.
  prompt(): string
  navigate(href: string): void
}

// Presses inside the zone stay out of the code around it, which selects
// lines and navigates names.
function stop(event: SyntheticEvent) {
  event.stopPropagation()
}

// CopyForAgent copies a follow-up prompt about this step (decision 0113).
function CopyForAgent({ prompt }: { prompt(): string }) {
  const { status, copy } = useClipboardCopy()
  const icon = status === "copied" ? <CheckIcon aria-hidden="true" /> : status === "failed" ? <XIcon aria-hidden="true" /> : <MessageSquareTextIcon aria-hidden="true" />
  return (
    <>
      <IconButton label="Copy Step for Agent" title={status === "failed" ? "Copy failed" : "Copy Step for Agent: ask a follow-up question"}
        tone={status === "copied" ? "success" : status === "failed" ? "destructive" : "default"} data-status={status} icon={icon}
        onClick={() => { void copy(prompt()) }} />
      <span className="visually-hidden" role="status">{status === "copied" ? "Step copied for an agent" : status === "failed" ? "Copy failed" : ""}</span>
    </>
  )
}

// Narration is a walkthrough step's story, inserted as a zone in the code it
// explains (decision 0047): below the step's lines in Source and diffs, at
// the top of a file or review without lines, and in the walkthrough's tab
// for notes.
export function Narration({ step, index, count, visited, check, controls, canMove, onMove, onFinish, onExit, prompt, navigate }: NarrationProps) {
  const last = index === count - 1
  return (
    <section className="narration" aria-label={`Step ${index + 1} of ${count}: ${step.title}`}
      onPointerDown={stop} onMouseDown={stop} onClick={stop} onPointerOver={stop}>
      <header className="narration-header">
        <span className="narration-count">Step {index + 1} of {count}</span>
        <h2 className="narration-title">{step.title}</h2>
        <div className="narration-actions">
          <CopyForAgent prompt={prompt} />
          {controls && <>
            <IconButton label="Previous Step" title={`Previous Step (${previousStepKeys})`}
              icon={<ChevronLeftIcon aria-hidden="true" />} disabledReason={canMove(-1) ? undefined : "This is the first step"}
              onClick={() => onMove(-1)} />
            {last
              ? <Button size="sm" variant="outline" title={`Finish (${nextStepKeys})`} onClick={onFinish}>Finish</Button>
              : <IconButton label="Next Step" title={`Next Step (${nextStepKeys})`}
                icon={<ChevronRightIcon aria-hidden="true" />} disabledReason={canMove(1) ? undefined : "This is the last step"}
                onClick={() => onMove(1)} />}
          </>}
          <IconButton label="Close Walkthrough" icon={<XIcon aria-hidden="true" />} onClick={onExit} />
        </div>
      </header>
      <StepProgress className="narration-progress" count={count} position={index} visited={visited} />
      {check.drift === "changed" && (
        <Notice tone="warning" role="note" className="narration-notice">
          <div>
            <p className="narration-notice-text">This code changed after the step was written, so it may not match the story.</p>
            {check.expected && (
              <dl className="narration-drift">
                <dt>Expected</dt>
                <dd><code>{check.expected}</code></dd>
                <dt>Now</dt>
                <dd>{check.actual ? <code>{check.actual}</code> : "No line here anymore"}</dd>
              </dl>
            )}
          </div>
        </Notice>
      )}
      {check.drift === "missing" && (
        <Notice tone="warning" role="note" className="narration-notice">
          This step's file isn't in this view anymore.
        </Notice>
      )}
      {step.bodyHTML && <div className="narration-body"><DocumentPreview html={step.bodyHTML} navigate={navigate} /></div>}
    </section>
  )
}
