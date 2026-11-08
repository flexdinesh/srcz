'use client'

import type { ReactNode } from 'react'
import { ArrowRight } from './icons'
import { InstallTabs } from './InstallTabs'
import { links } from './links'
import { StepPane } from './panes'
import { StepBar, StepList } from './StepBar'
import { type StepId, stepAnchor, stepNumber, steps } from './steps'
import { useActiveStep } from './use-active-step'

function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="landing-link" href={href}>
      {children}
      <ArrowRight />
    </a>
  )
}

function Actions() {
  return (
    <div className="landing-ctas">
      <a className="landing-button landing-button-primary" href={links.getStarted}>
        Get started
      </a>
      <a className="landing-button" href={links.docs}>
        Read the docs
      </a>
    </div>
  )
}

function Narration({ id }: { id: StepId }) {
  switch (id) {
    case 'overview':
      return (
        <>
          <h1>The code viewer for the agentic era.</h1>
          <p className="landing-lede">
            Browse files and review what agents change: diffs, commits, branches, and the walkthroughs agents
            publish. Read-only and lean. Local, or a remote box served to your laptop.
          </p>
          <InstallTabs />
          <Actions />
        </>
      )
    case 'browse':
      return (
        <>
          <h2>Browse any file.</h2>
          <p className="landing-lede">
            Every file in a folder, one command away. Markdown and images render, JSON and YAML format on demand,
            and everything else opens as highlighted source. Search names and content; go to definition through
            your language servers.
          </p>
          <pre className="landing-term">
            <span className="landing-prompt">$</span> srcz .
          </pre>
          <DocLink href={links.browsing}>Browsing</DocLink>
        </>
      )
    case 'diffs':
      return (
        <>
          <h2>Review like a pull request.</h2>
          <p className="landing-lede">
            Uncommitted work, commits, branches against any base, and commit ranges in one stacked diff, with line
            counts and Viewed marks. Changes refresh live while an agent works.
          </p>
          <DocLink href={links.sourceControl}>Source Control</DocLink>
        </>
      )
    case 'walkthroughs':
      return (
        <>
          <h2>Agents walk you through their changes.</h2>
          <p className="landing-lede">
            An agent publishes a guided tour of the files and diffs it touched. Each step opens its lines with the
            note inline. Steps pinned to a commit never move; if code drifts, the step says so instead of guessing.
          </p>
          <pre className="landing-term">
            <span className="landing-prompt">$</span> srcz walkthrough publish walkthrough.json
          </pre>
          <p className="landing-keys">
            <span>
              <kbd>Ctrl →</kbd> next step
            </span>
            <span>
              <kbd>Ctrl ←</kbd> previous
            </span>
          </p>
          <p className="landing-links">
            <DocLink href={links.walkthroughs}>Walkthroughs</DocLink>
            <DocLink href={links.agentSkill}>Agent skill</DocLink>
          </p>
        </>
      )
    case 'remote':
      return (
        <>
          <h2>Serve a remote box to your laptop.</h2>
          <p className="landing-lede">
            Run srcz with <code>--remote</code> beside the files, then <code>srcz connect</code> on your computer.
            The desktop app opens that machine in its own window over pinned TLS with a token. The host needs only
            the CLI.
          </p>
          <DocLink href={links.remote}>Remote hosts</DocLink>
        </>
      )
    case 'lean':
      return (
        <>
          <h2>Lean by construction.</h2>
          <p className="landing-lede">
            One Go binary with its web app embedded. The desktop app uses the OS web view, not Electron. Files are
            never written, and git objects are read directly, never through the git binary.
          </p>
          <InstallTabs />
          <Actions />
        </>
      )
  }
}

export function Walkthrough() {
  const active = useActiveStep(steps.length)

  return (
    <>
      <StepBar active={active} />
      <div className="landing-walk">
        <div className="landing-narration">
          {steps.map((step, index) => (
            <section
              key={step.id}
              id={stepAnchor(step.id)}
              className="landing-step"
              data-step-index={index}
              data-tint={step.tint}
            >
              <div className="landing-step-copy">
                <p className="landing-step-label">
                  {stepNumber(index)} / {step.label}
                </p>
                <Narration id={step.id} />
              </div>
              <div className="landing-step-pane">
                <StepPane id={step.id} />
              </div>
            </section>
          ))}
          <StepList active={active} />
        </div>
        <div className="landing-stage">
          <div className="landing-stage-sticky">
            <div className="landing-stage-inner">
              {steps.map((step, index) => (
                <div key={step.id} className="landing-stage-slot" data-active={index === active}>
                  <StepPane id={step.id} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
