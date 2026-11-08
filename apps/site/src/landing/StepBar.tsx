import { ChevronLeft, ChevronRight } from './icons'
import { stepAnchor, stepNumber, steps } from './steps'

// Pinned under the nav. Pips and Prev/Next are links to step anchors, so
// stepping is ordinary scrolling and history.
export function StepBar({ active }: { active: number }) {
  const current = steps[active] ?? steps[0]
  const previous = steps[active - 1]
  const next = steps[active + 1]
  if (current === undefined) return null

  return (
    <nav className="landing-stepbar" aria-label="Walkthrough steps">
      <span className="landing-label landing-stepbar-kind">Walkthrough</span>
      <span className="landing-stepbar-name">Source Zero</span>
      <span className="landing-dim">
        {active + 1} / {steps.length}
      </span>
      <ol className="landing-pips">
        {steps.map((step, index) => (
          <li key={step.id}>
            <a
              href={`#${stepAnchor(step.id)}`}
              className="landing-pip"
              data-tint={step.tint}
              data-state={index < active ? 'done' : index === active ? 'current' : 'todo'}
              aria-current={index === active ? 'step' : undefined}
              aria-label={`Step ${index + 1}: ${step.title}`}
            />
          </li>
        ))}
      </ol>
      <span className="landing-stepbar-title">{current.title}</span>
      <span className="landing-stepbar-actions">
        {previous === undefined ? (
          <span className="landing-chip" aria-disabled="true">
            <ChevronLeft />
            <span className="landing-stepbar-word">Prev</span>
          </span>
        ) : (
          <a className="landing-chip" href={`#${stepAnchor(previous.id)}`} aria-label={`Previous step: ${previous.title}`}>
            <ChevronLeft />
            <span className="landing-stepbar-word">Prev</span>
          </a>
        )}
        {next === undefined ? (
          <span className="landing-chip landing-chip-accent" aria-disabled="true">
            <span className="landing-stepbar-word">Next</span>
            <ChevronRight />
          </span>
        ) : (
          <a className="landing-chip landing-chip-accent" href={`#${stepAnchor(next.id)}`} aria-label={`Next step: ${next.title}`}>
            <span className="landing-stepbar-word">Next</span>
            <ChevronRight />
          </a>
        )}
      </span>
    </nav>
  )
}

export function StepList({ active }: { active: number }) {
  return (
    <nav className="landing-steplist" aria-label="Steps">
      <p className="landing-label">Steps</p>
      <ol>
        {steps.map((step, index) => (
          <li key={step.id}>
            <a
              href={`#${stepAnchor(step.id)}`}
              data-tint={step.tint}
              aria-current={index === active ? 'step' : undefined}
            >
              <span className="landing-dim">{stepNumber(index)}</span>
              {step.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
