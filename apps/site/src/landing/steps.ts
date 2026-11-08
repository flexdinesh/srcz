// The landing is a walkthrough of Source Zero (decision 0105). Each step is a
// section of the page and a pane on the sticky stage; its tint marks it in the
// step bar, the step list, and its section edge.

export type StepTint = 'blue' | 'green' | 'coral'

export type StepId = 'overview' | 'browse' | 'diffs' | 'walkthroughs' | 'remote' | 'lean'

export type Step = { id: StepId; label: string; title: string; tint: StepTint }

export const steps: Step[] = [
  { id: 'overview', label: 'overview', title: 'Code viewer for the agentic era', tint: 'blue' },
  { id: 'browse', label: 'browse', title: 'Browse any file', tint: 'blue' },
  { id: 'diffs', label: 'diffs', title: 'Diffs: commits, branches, ranges', tint: 'green' },
  { id: 'walkthroughs', label: 'walkthroughs', title: 'Agent walkthroughs', tint: 'blue' },
  { id: 'remote', label: 'remote', title: 'Remote: serve a box to your laptop', tint: 'coral' },
  { id: 'lean', label: 'lean', title: 'Lean by construction', tint: 'green' },
]

export function stepAnchor(id: StepId): string {
  return `step-${id}`
}

export function stepNumber(index: number): string {
  return String(index + 1).padStart(2, '0')
}
