import { useCallback, useMemo, useState } from "react"

import type { SourceComments, SourceZone } from "../documents/SourceDocument.tsx"
import type { LineRange } from "../../lib/line-selection.ts"
import { anchorKey, inlineThreads, lineRange, type FeedbackAnchorInput } from "./feedback-model.ts"
import { FeedbackComposer } from "./FeedbackComposer.tsx"
import { FeedbackThreadZone } from "./FeedbackThreadZone.tsx"
import { useFeedback } from "./use-feedback.ts"

export interface SourceFeedbackOptions {
  project: string
  // path is the Source tab's file; "" shows nothing.
  path: string
  // enabled while Source shows the working tree's text: not Preview,
  // Format, a snapshot, or a binary or too-large file.
  enabled: boolean
  version: number
  // showResolved is the View option: closed threads show inline.
  showResolved: boolean
  navigate(href: string): void
  onChanged(): void
  // onSubmitted follows a new thread: the selection it was made from clears.
  onSubmitted(): void
}

// useSourceFeedback reads the checkout's feedback, resolved against the
// working tree, and places the file's new-side threads and the comment
// composer as zones in Source (decision 0120). Source threads have no
// compare.
export function useSourceFeedback({
  enabled, navigate, onChanged, onSubmitted, path, project, showResolved, version,
}: SourceFeedbackOptions): SourceComments | undefined {
  const session = useFeedback({ project, id: "", compare: null, version, enabled: enabled && path !== "", onChanged })
  const [composing, setComposing] = useState<FeedbackAnchorInput | null>(null)
  // A composer belongs to the file it was opened in.
  const [composingFor, setComposingFor] = useState(path)
  if (composingFor !== path) {
    setComposingFor(path)
    setComposing(null)
  }
  const { feedback, start } = session

  const submit = useCallback(async (anchor: FeedbackAnchorInput, body: string) => {
    await start(anchor, body)
    setComposing(null)
    onSubmitted()
  }, [onSubmitted, start])
  const comment = useCallback((range: LineRange) => {
    setComposing({ path, side: "new", lines: [range.start, range.end], compare: null })
  }, [path])

  return useMemo((): SourceComments | undefined => {
    if (!enabled || !path) return undefined
    const zones: SourceZone[] = []
    if (feedback) {
      for (const thread of inlineThreads(feedback.threads, path, showResolved)) {
        if (thread.location.side !== "new") continue
        const lines = lineRange(thread.location.lines)
        zones.push({
          key: `thread-${thread.number}`,
          line: lines ? lines[1] : 0,
          node: <FeedbackThreadZone thread={thread} feedback={feedback} session={session} navigate={navigate} />,
        })
      }
    }
    if (composing?.path === path) {
      zones.push({
        key: "composer",
        line: composing.lines ? composing.lines[1] : 0,
        node: <FeedbackComposer key={anchorKey(composing)} anchor={composing} onSubmit={(body) => submit(composing, body)}
          onCancel={() => setComposing(null)} />,
      })
    }
    return { zones, onComment: comment }
  }, [comment, composing, enabled, feedback, navigate, path, session, showResolved, submit])
}
