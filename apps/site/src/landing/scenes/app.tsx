// Shared parts of the faux zero app the landing's scenes are built from: the
// window, activity bar, tabs, file bands, and diff and source lines. Every
// file, branch, and message in them is synthetic demo content.

import { FilesIcon, GitBranchIcon, MessageSquareIcon, RouteIcon, SearchIcon, SquareIcon, SquareCheckIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { Window } from '../kit'

export type View = 'files' | 'search' | 'source' | 'walkthroughs' | 'feedback'

const views: { id: View; icon: ReactNode }[] = [
  { id: 'files', icon: <FilesIcon /> },
  { id: 'search', icon: <SearchIcon /> },
  { id: 'source', icon: <GitBranchIcon /> },
  { id: 'walkthroughs', icon: <RouteIcon /> },
  { id: 'feedback', icon: <MessageSquareIcon /> },
]

// ActivityBar is the app's left rail of views; the active one carries the accent edge.
export function ActivityBar({ active, badge }: { active: View; badge?: number }) {
  return (
    <div className="zs-activity">
      {views.map((view) => (
        <span key={view.id} className="zs-activity-item" data-active={view.id === active || undefined}>
          {view.icon}
          {view.id === 'feedback' && badge !== undefined ? <span className="zs-activity-badge">{badge}</span> : null}
        </span>
      ))}
    </div>
  )
}

export type TabSpec = { name: string; icon?: ReactNode; active?: boolean }

export function Tabs({ tabs, trailing }: { tabs: TabSpec[]; trailing?: ReactNode }) {
  return (
    <div className="zs-tabs">
      {tabs.map((tab) => (
        <span key={tab.name} className="zs-tab" data-active={tab.active === true || undefined}>
          {tab.icon}
          <span>{tab.name}</span>
          {tab.active === true ? <XIcon className="zs-tab-close" /> : null}
        </span>
      ))}
      {trailing === undefined ? null : <span className="zs-tabs-trailing">{trailing}</span>}
    </div>
  )
}

export function Counts({ add, del }: { add: number; del: number }) {
  return (
    <span className="zs-counts">
      <span className="zs-add">+{add}</span>
      <span className="zs-del">−{del}</span>
    </span>
  )
}

// FileBand is a review's file header: path, counts, git status, and Viewed.
export function FileBand({ path, add, del, status, viewed }: { path: string; add: number; del: number; status: 'M' | 'A'; viewed: boolean }) {
  return (
    <div className="zs-band">
      <ChevronDownIcon className="zs-band-chevron" />
      <span className="zs-ts">TS</span>
      <span className="zs-band-path">{path}</span>
      <Counts add={add} del={del} />
      <span className="zs-band-status" data-status={status}>{status}</span>
      <span className="zs-viewed" data-viewed={viewed || undefined}>
        {viewed ? <SquareCheckIcon /> : <SquareIcon />}
        Viewed
      </span>
    </div>
  )
}

// LineNumber keeps the number in its own inline box, so the gutter is the
// column's and the number's box is only its digits.
function LineNumber({ n }: { n: number | undefined }) {
  return <span className="zs-ln">{n === undefined ? null : <span>{n}</span>}</span>
}

export type DiffKind = 'context' | 'add' | 'del'
export type DiffLineSpec = { old?: number; new?: number; kind: DiffKind; code: ReactNode }

// DiffLine is one unified diff row: old and new numbers, a change bar, and code.
export function DiffLine({ line, selected, ...rest }: { line: DiffLineSpec; selected?: boolean } & HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, unknown>) {
  return (
    <div {...rest} className="zs-line" data-kind={line.kind} data-selected={selected || undefined}>
      <LineNumber n={line.old} />
      <LineNumber n={line.new} />
      <span className="zs-code">{line.code}</span>
    </div>
  )
}

export type SourceLineSpec = { n: number; code: ReactNode; highlight?: boolean }

export function SourceLine({ line }: { line: SourceLineSpec }) {
  return (
    <div className="zs-line zs-src" data-highlight={line.highlight === true || undefined}>
      <LineNumber n={line.n} />
      <span className="zs-code">{line.code}</span>
    </div>
  )
}

// Syntax tokens, in the app's highlight colors.
export const kw = (text: string) => <span className="zs-kw">{text}</span>
export const fn = (text: string) => <span className="zs-fn">{text}</span>
export const str = (text: string) => <span className="zs-str">{text}</span>
export const num = (text: string) => <span className="zs-num">{text}</span>

export function StatusBar({ children }: { children: ReactNode }) {
  return <div className="zs-status">{children}</div>
}

// ZeroWindow is the desktop app's window: the title band, the activity bar,
// and the workspace beside it.
export function ZeroWindow({ title, active, badge, side, children, className, ...rest }: {
  title: string
  active: View
  badge?: number
  side?: ReactNode
  children: ReactNode
} & HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, unknown>) {
  return (
    <Window {...rest} title={title} className={`zs-window${className === undefined ? '' : ` ${className}`}`}>
      <div className="zs-workspace">
        <ActivityBar active={active} badge={badge} />
        {side === undefined ? null : <div className="zs-side">{side}</div>}
        <div className="zs-main">{children}</div>
      </div>
    </Window>
  )
}
