import { isFeedbackCompare } from "@zero/contracts"
import { useCallback, useMemo, useState } from "react"

import { compareKey, type Compare } from "../source-control/compare.ts"
import type { ReviewComments, ReviewZone } from "../source-control/ReviewDocument.tsx"
import {
  anchorKey, diffSide, feedbackCompare, inlineThreads, lineRange, openCounts, outdatedCount, type FeedbackAnchorInput,
} from "./feedback-model.ts"
import { FeedbackComposer } from "./FeedbackComposer.tsx"
import { FeedbackThreadZone } from "./FeedbackThreadZone.tsx"
import { useFeedback, type FeedbackSession } from "./use-feedback.ts"

export interface ReviewFeedbackOptions {
  project: string
  // compare is the shown review's; null reads nothing.
  compare: Compare | null
  version: number
  // showResolved is the View option: closed threads show inline.
  showResolved: boolean
  navigate(href: string): void
  onChanged(): void
  // onSubmitted follows a new thread: the selection it was made from clears.
  onSubmitted(path: string): void
  // onShowOutdated opens the Feedback view at a file's outdated threads.
  onShowOutdated(id: string, path: string): void
}

export interface ReviewFeedback {
  comments: ReviewComments | undefined
  // counts are each file's open threads, for the Files rail.
  counts: ReadonlyMap<string, number>
  session: FeedbackSession
}

const noCounts: ReadonlyMap<string, number> = new Map()

// useReviewFeedback reads the shown review's feedback, resolved against its
// compare, and places its threads and the comment composer as zones in the
// review (decision 0120).
export function useReviewFeedback({
  compare, navigate, onChanged, onShowOutdated, onSubmitted, project, showResolved, version,
}: ReviewFeedbackOptions): ReviewFeedback {
  const key = compare ? compareKey(compare) : ""
  // The compare by value, so a new object for the same review rereads nothing.
  const contractText = compare ? JSON.stringify(feedbackCompare(compare)) : ""
  const contract = useMemo(() => {
    const value: unknown = contractText ? JSON.parse(contractText) : null
    return isFeedbackCompare(value) ? value : null
  }, [contractText])
  const session = useFeedback({ project, id: "", compare: contract, version, enabled: contract !== null, onChanged })
  const [composing, setComposing] = useState<FeedbackAnchorInput | null>(null)
  // A composer belongs to the review it was opened in.
  const [composingFor, setComposingFor] = useState(key)
  if (composingFor !== key) {
    setComposingFor(key)
    setComposing(null)
  }
  const { feedback, start } = session

  const submit = useCallback(async (anchor: FeedbackAnchorInput, body: string) => {
    await start(anchor, body)
    setComposing(null)
    onSubmitted(anchor.path)
  }, [onSubmitted, start])

  const comments = useMemo((): ReviewComments | undefined => {
    if (!contract) return undefined
    const threads = feedback?.threads ?? []
    return {
      zones(path) {
        const zones: ReviewZone[] = []
        if (feedback) {
          for (const thread of inlineThreads(threads, path, showResolved)) {
            const lines = lineRange(thread.location.lines)
            zones.push({
              key: `thread-${thread.number}`,
              side: diffSide(thread.location.side),
              line: lines ? lines[1] : 0,
              node: <FeedbackThreadZone thread={thread} feedback={feedback} session={session} navigate={navigate} />,
            })
          }
        }
        if (composing?.path === path) {
          zones.push({
            key: "composer",
            side: diffSide(composing.side),
            line: composing.lines ? composing.lines[1] : 0,
            node: <FeedbackComposer key={anchorKey(composing)} anchor={composing} onSubmit={(body) => submit(composing, body)}
              onCancel={() => setComposing(null)} />,
          })
        }
        return zones
      },
      outdated: (path) => outdatedCount(threads, path, showResolved),
      onShowOutdated: (path) => onShowOutdated(feedback?.id ?? "", path),
      onComment(path, side, lines) {
        setComposing({ path, side, lines, compare: contract })
      },
    }
  }, [composing, contract, feedback, navigate, onShowOutdated, session, showResolved, submit])

  const counts = useMemo(() => feedback ? openCounts(feedback.threads) : noCounts, [feedback])
  return { comments, counts, session }
}
