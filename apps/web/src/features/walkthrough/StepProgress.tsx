import { maxProgressSegments, type StepPosition } from "./walkthrough-steps.ts"

interface StepProgressProps {
  count: number
  // position is the current step, or null for the overview.
  position: StepPosition
  visited: ReadonlySet<number>
  className?: string
}

// StepProgress is a walkthrough's progress line (decision 0113): one mark
// per step, read or current marks filled, as CodeTour's and product tours'
// step dots are; past maxProgressSegments steps, a continuous bar to the
// current step. The step count beside it carries the same news in words,
// so it is hidden from assistive technology.
export function StepProgress({ className, count, position, visited }: StepProgressProps) {
  if (count === 0) return null
  const classes = `step-progress${className ? ` ${className}` : ""}`
  if (count > maxProgressSegments) {
    const done = position === null ? 0 : position + 1
    return (
      <span className={classes} data-kind="bar" aria-hidden="true">
        <span className="step-progress-fill" style={{ inlineSize: `${(done / count) * 100}%` }} />
      </span>
    )
  }
  return (
    <span className={classes} data-kind="segments" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="step-progress-mark"
          data-state={index === position ? "current" : visited.has(index) ? "visited" : undefined} />
      ))}
    </span>
  )
}
