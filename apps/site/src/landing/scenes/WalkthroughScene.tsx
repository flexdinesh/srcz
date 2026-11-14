'use client'

// The walkthroughs row: step 2 of an agent's tour (decisions 0047, 0135). The
// step's story sits in the narration panel above the document, the code
// keeps the step's lines lit and a slim marker under them, and the
// Walkthroughs view lists the steps.

import {
  ArrowLeftIcon, BookOpenIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, FileCodeIcon, MapPinIcon,
  MessageSquareTextIcon, PanelRightIcon, RouteIcon, StickyNoteIcon, XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Stage } from '../kit'
import { SourceLine, Tabs, ZeroWindow, fn, kw, num, type SourceLineSpec } from './app'
import './walkthrough.css'

type Step = { n: number; title: string; meta: string; icon: ReactNode; read?: boolean; current?: boolean }

const steps: Step[] = [
  { n: 1, title: 'One check for every route', meta: 'routes.ts:5', icon: <FileCodeIcon />, read: true },
  { n: 2, title: 'Expire by age, not activity', meta: 'session.ts:6–7', icon: <FileCodeIcon />, current: true },
  { n: 3, title: 'Tests for stale sessions', meta: 'session.test.ts:12–30', icon: <FileCodeIcon /> },
  { n: 4, title: 'What to check next', meta: 'Note', icon: <StickyNoteIcon /> },
]

const lead: SourceLineSpec[] = [
  { n: 1, code: <>{kw('const')} maxAge = {num('30')} * {num('60')} * {num('1000')}</> },
  { n: 2, code: '' },
  { n: 3, code: <>{kw('export function')} {fn('requireFreshSession')}(</> },
  { n: 4, code: <span>{'  req, res, next,'}</span> },
  { n: 5, code: <span>{') {'}</span> },
  { n: 6, highlight: true, code: <>{'  '}{kw('const')} at = req.session?.issuedAt ?? {num('0')}</> },
  { n: 7, highlight: true, code: <>{'  '}{kw('if')} (Date.now() - at &gt; maxAge) {'{'}</> },
]

const tail: SourceLineSpec[] = [
  { n: 8, code: <>{'    '}{kw('return')} res.status({num('401')}).end()</> },
  { n: 9, code: <span>{'  }'}</span> },
  { n: 10, code: <span>{'  next()'}</span> },
  { n: 11, code: <span>{'}'}</span> },
]

function WalkthroughsView() {
  return (
    <div className="ws-view">
      <div className="ws-view-head">
        <span>Walkthroughs</span>
        <ArrowLeftIcon />
      </div>
      <div className="ws-heading">
        <span className="ws-title">Session expiry fix</span>
        <span className="ws-meta">Step 2 of 4 · 1 read · 2m</span>
      </div>
      <div className="ws-step">
        <span className="ws-step-n" />
        <BookOpenIcon className="ws-step-icon" />
        <span className="ws-step-text">
          <span className="ws-step-title">Overview</span>
        </span>
      </div>
      {steps.map((step) => (
        <div key={step.n} className="ws-step" data-current={step.current || undefined}>
          <span className="ws-step-n">{step.read === true ? <CheckIcon className="ws-read" /> : step.n}</span>
          <span className="ws-step-icon">{step.icon}</span>
          <span className="ws-step-text">
            <span className="ws-step-title">{step.title}</span>
            <span className="ws-step-meta">{step.meta}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function NarrationPanel() {
  return (
    <div className="ws-narration">
      <div className="ws-narration-head">
        <ChevronDownIcon className="ws-narration-icon" />
        <span className="ws-count">Step 2 of 4</span>
        <span className="ws-narration-title">Expire by age, not activity</span>
        <span className="ws-actions">
          <MessageSquareTextIcon />
          <ChevronLeftIcon />
          <ChevronRightIcon />
          <XIcon />
        </span>
      </div>
      <div className="ws-progress">
        <span data-state="visited" />
        <span data-state="current" />
        <span />
        <span />
      </div>
      <p className="ws-body">
        Age is measured from <code>issuedAt</code>, so a session that stays busy still expires after 30 minutes.
      </p>
    </div>
  )
}

export function WalkthroughScene() {
  return (
    <Stage width={728} height={440} compact={{ below: 560, width: 358, height: 340 }} initial={{}} className="zs ws">
      {() => (
        <ZeroWindow className="ws-window" title="session.ts · api" active="walkthroughs" side={<WalkthroughsView />}>
          <Tabs tabs={[{ name: 'Session expiry fix', icon: <RouteIcon /> }, { name: 'session.ts', active: true }]} trailing={<PanelRightIcon />} />
          <NarrationPanel />
          <div className="zs-lines ws-code">
            {lead.map((line) => (
              <SourceLine key={line.n} line={line} />
            ))}
            <div className="ws-marker">
              <MapPinIcon />
              Step 2
            </div>
            {tail.map((line) => (
              <SourceLine key={line.n} line={line} />
            ))}
          </div>
        </ZeroWindow>
      )}
    </Stage>
  )
}
