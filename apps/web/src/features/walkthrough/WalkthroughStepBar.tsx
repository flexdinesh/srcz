import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ListOrderedIcon, XIcon } from "lucide-react"

import { IconButton } from "../../components/ui/icon-button.tsx"
import type { Walkthrough } from "@zero/contracts"
import { nextStepKeys, previousStepKeys } from "./Narration.tsx"
import { StepProgress } from "./StepProgress.tsx"
import type { StepPosition } from "./walkthrough-steps.ts"

interface WalkthroughStepBarProps {
  walkthrough: Walkthrough
  position: StepPosition
  visited: ReadonlySet<number>
  presenting: boolean
  canMove(direction: 1 | -1): boolean
  onMove(direction: 1 | -1): void
  onFinish(): void
  // onSteps opens the step list; phones show it in the drawer.
  onSteps?: () => void
  onStopPresenting(): void
}

// WalkthroughStepBar floats over the document while presenting, and on
// phones while following a walkthrough (decision 0047): Previous, where the
// step is, Next (Finish on the last step, decision 0113), and the step list
// or the way out of presenting. It carries the only step controls there.
export function WalkthroughStepBar({ canMove, onFinish, onMove, onSteps, onStopPresenting, position, presenting, visited, walkthrough }: WalkthroughStepBarProps) {
  const count = walkthrough.steps.length
  const step = position === null ? undefined : walkthrough.steps[position]
  const last = position !== null && position === count - 1
  const keys = presenting ? "→" : nextStepKeys
  return (
    <div className="walkthrough-step-bar" role="toolbar" aria-label={`Walkthrough: ${walkthrough.title}`}>
      <div className="walkthrough-step-bar-controls">
        <IconButton size="md" label="Previous Step" title={`Previous Step (${presenting ? "←" : previousStepKeys})`}
          icon={<ChevronLeftIcon aria-hidden="true" />} disabledReason={canMove(-1) ? undefined : "This is the overview"}
          onClick={() => onMove(-1)} />
        <span className="walkthrough-step-bar-position" aria-live="polite">
          {position === null ? "Overview" : `${(position + 1).toLocaleString()} / ${count.toLocaleString()}`}
        </span>
        <span className="walkthrough-step-bar-title">{step?.title ?? walkthrough.title}</span>
        {last
          ? <IconButton size="md" label="Finish Walkthrough" title={`Finish Walkthrough (${keys})`} icon={<CheckIcon aria-hidden="true" />} onClick={onFinish} />
          : <IconButton size="md" label="Next Step" title={`Next Step (${keys})`}
            icon={<ChevronRightIcon aria-hidden="true" />} disabledReason={canMove(1) ? undefined : "This is the last step"}
            onClick={() => onMove(1)} />}
        {onSteps && <IconButton size="md" label="Steps" icon={<ListOrderedIcon aria-hidden="true" />} onClick={onSteps} />}
        {presenting && (
          <IconButton size="md" label="Stop Presenting" title="Stop Presenting (Esc)" icon={<XIcon aria-hidden="true" />}
            onClick={onStopPresenting} />
        )}
      </div>
      <StepProgress className="walkthrough-step-bar-progress" count={count} position={position} visited={visited} />
    </div>
  )
}
