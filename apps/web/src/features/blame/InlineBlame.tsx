import { ExternalLinkIcon, GitCommitHorizontalIcon, HistoryIcon } from "lucide-react"
import { useLayoutEffect, useRef } from "react"

import { Button } from "../../components/ui/button.tsx"
import { CopyButton } from "../../components/ui/copy-button.tsx"
import { HoverCard } from "../../components/ui/hover-card.tsx"
import { shortHash } from "../../lib/commit-hash.ts"
import { commitAge, commitDate } from "../source-control/compare.ts"
import { blameLabel, blameText, boundaryNote, type LineBlame } from "./blame-model.ts"

interface InlineBlameProps {
  blame: LineBlame
  // now is when the blame was read; ages count from it.
  now: number
  open: boolean
  // reveal scrolls the blame into view as it opens, for the palette.
  reveal: boolean
  onOpenChange(open: boolean): void
  // onOpenCommit opens the commit's review at the line's place in it.
  onOpenCommit(hash: string, line: number): void
  onShowHistory(): void
}

function cardLabel(blame: LineBlame): string {
  const commit = blame.commit
  if (!commit) return "Uncommitted changes"
  const hash = shortHash(commit.hash)
  return blame.kind === "boundary" ? `Commit ${hash}, where blame stopped` : `Commit ${hash} by ${commit.author.name}`
}

// InlineBlame is the active line's blame after its text: muted code-face
// text that opens a card with the commit and its actions. It is no Tab stop;
// the palette's Show Line Blame opens the card by keyboard.
export function InlineBlame({ blame, now, open, reveal, onOpenChange, onOpenCommit, onShowHistory }: InlineBlameProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  // The card's first action takes focus: Open Commit, else Show File History.
  const primary = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (open && reveal) trigger.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [open, reveal])
  const commit = blame.commit
  const showHistory = () => {
    onOpenChange(false)
    onShowHistory()
  }
  const historyButton = (
    <Button ref={commit ? undefined : primary} variant="ghost" size="sm" onClick={showHistory}><HistoryIcon aria-hidden="true" />Show File History</Button>
  )

  return (
    <HoverCard trigger={<span className="blame-inline-text">{blameText(blame, now)}</span>} triggerLabel={blameLabel(blame, now)}
      triggerClassName="blame-inline" triggerRef={trigger} tabbable={false} label={cardLabel(blame)} open={open}
      onOpenChange={onOpenChange} initialFocus={primary} className="blame-card">
      {commit ? (
        <>
          <div className="blame-card-head">
            <span className="blame-card-author">{commit.author.name}</span>
            {commit.author.email && <span className="blame-card-email">{commit.author.email}</span>}
            <time className="blame-card-time" dateTime={commit.authorTime} title={commitDate(commit.authorTime)}>
              {commitAge(commit.authorTime, now).long}
            </time>
          </div>
          <p className="blame-card-subject">{commit.subject}</p>
          {commit.body && <p className="blame-card-body">{commit.body}</p>}
          {blame.kind === "boundary" && <p className="blame-card-note">{boundaryNote}</p>}
          <div className="blame-card-hash">
            <code>{shortHash(commit.hash)}</code>
            <CopyButton text={commit.hash} label="Copy Hash" />
          </div>
          <div className="blame-card-actions">
            <Button ref={primary} variant="ghost" size="sm" onClick={() => onOpenCommit(commit.hash, blame.originalLine)}>
              <GitCommitHorizontalIcon aria-hidden="true" />Open Commit
            </Button>
            {historyButton}
            {commit.pullRequest && (
              <Button variant="ghost" size="sm" nativeButton={false}
                render={<a href={commit.pullRequest.url} target="_blank" rel="noreferrer"
                  aria-label={`Open pull request #${commit.pullRequest.number} on GitHub`} />}>
                <ExternalLinkIcon aria-hidden="true" />Open PR #{commit.pullRequest.number}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="blame-card-subject">Uncommitted changes</p>
          <div className="blame-card-actions">{historyButton}</div>
        </>
      )}
    </HoverCard>
  )
}
