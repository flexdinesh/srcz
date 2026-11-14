'use client'

// Diffs: the Source Control view beside a branch review against main, files
// stacked with counts and Viewed marks. A still.

import { ChevronDownIcon, ChevronRightIcon, GitBranchIcon, GitCompareArrowsIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Stage } from '../kit'
import { Counts, DiffLine, FileBand, Tabs, ZeroWindow, fn, kw, num, type DiffLineSpec } from './app'
import './diffs.css'

function Section({ open, title, meta, children }: { open: boolean; title: string; meta: string; children?: ReactNode }) {
  return (
    <div className="ds-section">
      <div className="ds-section-head">
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span className="ds-section-title">{title}</span>
        <span className="ds-dim">{meta}</span>
      </div>
      {children}
    </div>
  )
}

const commits = [
  { title: 'expire sessions by age', hash: '9f3c2e1', age: '2h' },
  { title: 'add session middleware', hash: '41ab0d7', age: '3h' },
  { title: 'cover session expiry', hash: 'c02e9f4', age: '3h' },
]

function SourceControl() {
  return (
    <div className="ds-sc">
      <div className="ds-sc-head">Source Control</div>
      <Section open={false} title="Uncommitted" meta="1" />
      <Section open title="Commits" meta="3 ahead of main">
        {commits.map((commit) => (
          <div key={commit.hash} className="ds-commit">
            <span className="ds-commit-title">{commit.title}</span>
            <span className="ds-dim">
              agent · {commit.age} · <span className="ds-hash">{commit.hash}</span>
            </span>
          </div>
        ))}
      </Section>
      <Section open title="Branches" meta="base main">
        <div className="ds-branch" data-selected>
          <GitBranchIcon />
          <span>agent/session-expiry</span>
        </div>
        <div className="ds-branch">
          <GitBranchIcon />
          <span>main</span>
          <span className="ds-dim">merge-base</span>
        </div>
        {['agent/billing-retries', 'agent/cache-keys', 'docs/remote-hosts'].map((name) => (
          <div key={name} className="ds-branch">
            <GitBranchIcon />
            <span>{name}</span>
          </div>
        ))}
      </Section>
    </div>
  )
}

const session: DiffLineSpec[] = [
  { new: 1, kind: 'add', code: <>{kw('const')} maxAge = {num('30')} * {num('60')} * {num('1000')}</> },
  { new: 2, kind: 'add', code: ' ' },
  { new: 3, kind: 'add', code: <>{kw('export function')} {fn('requireFreshSession')}(</> },
  { new: 4, kind: 'add', code: '  req, res, next,' },
  { new: 5, kind: 'add', code: ') {' },
  { new: 6, kind: 'add', code: <>{'  '}{kw('const')} at = req.session?.issuedAt ?? {num('0')}</> },
  { new: 7, kind: 'add', code: <>{'  '}{kw('if')} (Date.now() - at &gt; maxAge) {'{'}</> },
  { new: 8, kind: 'add', code: <>{'    '}{kw('return')} res.status({num('401')}).end()</> },
  { new: 9, kind: 'add', code: '  }' },
  { new: 10, kind: 'add', code: '  next()' },
  { new: 11, kind: 'add', code: '}' },
]

export function DiffsScene() {
  return (
    <Stage width={728} height={460} compact={{ below: 560, width: 358, height: 340 }} initial={{}} className="zs ds">
      {() => (
        <ZeroWindow className="ds-window" title="vs main · api" active="source" side={<SourceControl />}>
          <Tabs tabs={[{ name: 'vs main', icon: <GitCompareArrowsIcon />, active: true }]} />
          <div className="ds-review">
            <div className="ds-review-head">
              <div className="ds-review-title">vs main</div>
              <div className="ds-dim">
                3 commits ahead of main · merge-base <span className="ds-hash">1ed93ea</span>
              </div>
              <div className="ds-review-stats">
                <span>3 files</span>
                <Counts add={59} del={2} />
                <span className="ds-dim">1 of 3 viewed</span>
              </div>
            </div>
            <div className="zs-file ds-collapsed">
              <FileBand path="routes.ts" add={3} del={2} status="M" viewed />
            </div>
            <div className="zs-file">
              <FileBand path="middleware/session.ts" add={11} del={0} status="A" viewed={false} />
              <div className="zs-lines">
                {session.map((line) => (
                  <DiffLine key={line.new} line={line} />
                ))}
              </div>
            </div>
          </div>
        </ZeroWindow>
      )}
    </Stage>
  )
}
