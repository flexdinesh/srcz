'use client'

// The feedback row: the Feedback view's threads across a branch beside the
// review, one thread open where the agent has answered (decision 0120). The
// hero plays one round trip; this still shows what a review collects.

import {
  ChevronDownIcon, CircleCheckIcon, CircleDotIcon, CircleSlashIcon, ClipboardListIcon, EllipsisIcon, GitBranchIcon,
  GitCompareArrowsIcon, MessageSquareTextIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Stage } from '../kit'
import { DiffLine, FileBand, Tabs, ZeroWindow, fn, kw, num, type DiffLineSpec } from './app'
import './feedback.css'

type Status = 'open' | 'resolved' | 'wontfix'

type Row = { status: Status; title: string; meta: string; fresh?: boolean; current?: boolean }

const groups: { path: string; rows: Row[] }[] = [
  {
    path: 'src/middleware/session.ts',
    rows: [
      { status: 'open', title: 'Make maxAge configurable?', meta: 'session.ts:1 · agent, 1m', fresh: true, current: true },
      { status: 'open', title: 'Return 401 with a reason', meta: 'session.ts:8 · you, 4m' },
    ],
  },
  {
    path: 'src/routes.ts',
    rows: [
      { status: 'resolved', title: 'Does /health need this too?', meta: 'routes.ts:5 · agent, 9m' },
      { status: 'wontfix', title: 'Rename checkExpiry?', meta: 'routes.ts:2 · agent, 12m' },
    ],
  },
]

const statusIcon: Record<Status, ReactNode> = {
  open: <CircleDotIcon />,
  resolved: <CircleCheckIcon />,
  wontfix: <CircleSlashIcon />,
}

const anchored: DiffLineSpec = { new: 1, kind: 'add', code: <>{kw('const')} maxAge = {num('30')} * {num('60')} * {num('1000')}</> }

const rest: DiffLineSpec[] = [
  { new: 2, kind: 'add', code: '' },
  { new: 3, kind: 'add', code: <>{kw('export function')} {fn('requireFreshSession')}(</> },
  { new: 4, kind: 'add', code: '  req, res, next,' },
  { new: 5, kind: 'add', code: ') {' },
  { new: 6, kind: 'add', code: <>{'  '}{kw('const')} at = req.session?.issuedAt ?? {num('0')}</> },
  { new: 7, kind: 'add', code: <>{'  '}{kw('if')} (Date.now() - at &gt; maxAge) {'{'}</> },
  { new: 8, kind: 'add', code: <>{'    '}{kw('return')} res.status({num('401')}).end()</> },
]

function FeedbackView() {
  return (
    <div className="fs-view">
      <div className="fs-view-head">
        <span>Feedback</span>
        <ClipboardListIcon />
        <EllipsisIcon />
      </div>
      <div className="fs-branch">
        <GitBranchIcon />
        <span>agent/session-expiry</span>
        <ChevronDownIcon />
      </div>
      <div className="fs-meta">
        <span className="fs-id">fb-q7rk2m</span>
        <span>4 threads · 1 new reply</span>
      </div>
      <div className="fs-filter">
        <span>Open</span>
        <span>Awaiting agent</span>
        <span>Resolved</span>
        <span data-on>All</span>
      </div>
      {groups.map((group) => (
        <div key={group.path} className="fs-group">
          <div className="fs-group-head">
            <span className="zs-ts">TS</span>
            <span className="fs-ellipsis">{group.path}</span>
          </div>
          {group.rows.map((row) => (
            <div key={row.title} className="fs-row" data-current={row.current || undefined}>
              <span className="fs-status" data-status={row.status}>{statusIcon[row.status]}</span>
              <span className="fs-row-text">
                <span className="fs-row-title">{row.title}</span>
                <span className="fs-row-meta">{row.meta}</span>
              </span>
              {row.fresh === true ? <span className="fs-new" /> : <span />}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Message({ author, time, children }: { author: 'you' | 'agent'; time: string; children: ReactNode }) {
  return (
    <div className="fs-message">
      <span className="fs-author" data-author={author}>
        {author}
        <span className="fs-time">{time}</span>
      </span>
      <span className="fs-words">{children}</span>
    </div>
  )
}

function Thread() {
  return (
    <div className="fs-thread">
      <div className="fs-thread-head">
        <span className="fs-thread-status">
          <CircleDotIcon />
          Open
        </span>
        <span className="fs-thread-place">Thread 3</span>
        <MessageSquareTextIcon className="fs-thread-copy" />
        <span className="fs-thread-action">Resolve</span>
      </div>
      <Message author="you" time="6m">
        Make <code>maxAge</code> configurable? Staging wants 15 minutes.
      </Message>
      <Message author="agent" time="1m">
        Kept the constant: nothing else reads session config yet. Say so and I&apos;ll move it.
      </Message>
      <div className="fs-reply">Reply…</div>
    </div>
  )
}

export function FeedbackScene() {
  return (
    <Stage width={728} height={440} compact={{ below: 560, width: 358, height: 340 }} initial={{}} className="zs fs">
      {() => (
        <ZeroWindow className="fs-window" title="vs main · api" active="feedback" side={<FeedbackView />}>
          <Tabs tabs={[{ name: 'vs main', icon: <GitCompareArrowsIcon />, active: true }]} />
          <div className="zs-file">
            <FileBand path="src/middleware/session.ts" add={9} del={0} status="A" viewed={false} />
            <div className="zs-lines">
              <DiffLine line={anchored} />
              <Thread />
              {rest.map((line, index) => (
                <DiffLine key={index} line={line} />
              ))}
            </div>
          </div>
        </ZeroWindow>
      )}
    </Stage>
  )
}
