import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ListOrderedIcon, MessageSquareTextIcon, ScreenShareOffIcon, XIcon } from "lucide-react"
import { useId } from "react"

import { Button } from "../../components/ui/button.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import { Notice } from "../../components/ui/notice.tsx"
import type { WalkthroughStep } from "@zero/contracts"
import { useClipboardCopy } from "../../lib/clipboard.ts"
import { DocumentPreview } from "../documents/DocumentPreview.tsx"
import { nextStepKeys, previousStepKeys } from "./Narration.tsx"
import { StepProgress } from "./StepProgress.tsx"
import type { StepCheck } from "./walkthrough-steps.ts"

export interface NarrationPanelProps {
  step: WalkthroughStep
  index: number
  count: number
  // visited are the steps read so far, for the progress line.
  visited: ReadonlySet<number>
  // check is whether the step's code changed since it was written, with the
  // line it expected and the line there now (decision 0113).
  check: StepCheck
  // presenting steps on plain arrows and offers Stop Presenting.
  presenting: boolean
  collapsed: boolean
  onCollapsedChange(collapsed: boolean): void
  canMove(direction: 1 | -1): boolean
  onMove(direction: 1 | -1): void
  onFinish(): void
  onExit(): void
  onStopPresenting(): void
  // onSteps opens the step list; phones show it in the drawer.
  onSteps?: () => void
  // prompt is the text Copy for Agent copies.
  prompt(): string
  navigate(href: string): void
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

// NarrationPanel is a walkthrough step's story, in one place for every step
// (decision 0135): under the tab strip, above the document, so stepping and
// scrolling never move it. It carries the step controls; a long story
// scrolls inside it, and Collapse folds it to its header.
export function NarrationPanel(props: NarrationPanelProps) {
  const { step, index, count, visited, check, presenting, collapsed, onCollapsedChange, canMove, onMove, onFinish, onExit, onStopPresenting, onSteps, prompt, navigate } = props
  const contentId = useId()
  const last = index === count - 1
  const next = presenting ? "→" : nextStepKeys
  const previous = presenting ? "←" : previousStepKeys
  const notices = check.drift === "changed" || check.drift === "missing"
  const hasContent = notices || Boolean(step.bodyHTML)
  return (
    <section className="narration-panel" aria-label={`Step ${index + 1} of ${count}: ${step.title}`} data-collapsed={collapsed || undefined}>
      <header className="narration-header">
        <IconButton size="md" className="narration-toggle" label={collapsed ? "Expand Explanation" : "Collapse Explanation"}
          aria-expanded={!collapsed} aria-controls={contentId} disabledReason={hasContent ? undefined : "This step has no explanation"}
          icon={<ChevronDownIcon aria-hidden="true" />} onClick={() => onCollapsedChange(!collapsed)} />
        <span className="narration-count">Step {(index + 1).toLocaleString()} of {count.toLocaleString()}</span>
        <h2 className="narration-title">{step.title}</h2>
        <div className="narration-actions">
          <CopyForAgent prompt={prompt} />
          {onSteps && <IconButton size="md" label="Steps" icon={<ListOrderedIcon aria-hidden="true" />} onClick={onSteps} />}
          <IconButton size="md" label="Previous Step" title={`Previous Step (${previous})`}
            icon={<ChevronLeftIcon aria-hidden="true" />} disabledReason={canMove(-1) ? undefined : "This is the first step"}
            onClick={() => onMove(-1)} />
          {last
            ? <Button size="sm" variant="outline" title={`Finish (${next})`} onClick={onFinish}>Finish</Button>
            : <IconButton size="md" label="Next Step" title={`Next Step (${next})`}
              icon={<ChevronRightIcon aria-hidden="true" />} disabledReason={canMove(1) ? undefined : "This is the last step"}
              onClick={() => onMove(1)} />}
          {presenting && <IconButton size="md" label="Stop Presenting" title="Stop Presenting (Esc)"
            icon={<ScreenShareOffIcon aria-hidden="true" />} onClick={onStopPresenting} />}
          <IconButton size="md" label="Close Walkthrough" icon={<XIcon aria-hidden="true" />} onClick={onExit} />
        </div>
      </header>
      <StepProgress className="narration-progress" count={count} position={index} visited={visited} />
      <div className="narration-content" id={contentId} hidden={collapsed || !hasContent}>
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
      </div>
    </section>
  )
}
