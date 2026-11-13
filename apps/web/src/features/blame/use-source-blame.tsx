import { useCallback, useEffect, useMemo, useState } from "react"

import { isBlameResponse, type BlameResponse, type PageData } from "@zero/contracts"
import { failureReason, fetchJSON } from "../../api/http.ts"
import { splitSourceLines } from "../../lib/line-selection.ts"
import type { SourceBlame } from "../documents/SourceDocument.tsx"
import type { Compare, reviewFragment } from "../source-control/compare.ts"
import { blameAvailable, blameUrl, lineBlame } from "./blame-model.ts"
import { InlineBlame } from "./InlineBlame.tsx"

interface SourceBlameOptions {
  project: string
  page: PageData
  // enabled is the setting on and Source shown in its Source mode.
  enabled: boolean
  // gitVersion counts git state changes: HEAD may have moved.
  gitVersion: number
  openReview(compare: Compare, focusDocument: boolean, path: string, lines: Parameters<typeof reviewFragment>[1]): void
  showFileHistory(path: string): void
}

export interface SourceBlameState {
  // blame is Source's inline blame, undefined while disabled.
  blame: SourceBlame | undefined
  // showCard opens the active line's card, focused, and reports whether
  // there was one.
  showCard(): boolean
}

// useSourceBlame reads the open Source document's blame (decision 0139):
// lazily, once a line is active, then again whenever the shown text (a live
// reread) or HEAD (gitVersion) moves; a snapshot's never does. Until a reread
// lands the last result for the same document stays; one blaming other text
// (its line count differs) shows nothing.
export function useSourceBlame({ project, page, enabled, gitVersion, openReview, showFileHistory }: SourceBlameOptions): SourceBlameState {
  const available = enabled && blameAvailable(page)
  const path = page.selected
  const at = page.at
  const text = page.source
  const documentKey = `${project}\n${path}\n${at}`
  const [active, setActive] = useState<{ key: string; line: number } | null>(null)
  const activeLine = active?.key === documentKey ? active.line : null
  const requested = available && activeLine !== null
  const version = at ? 0 : gitVersion
  const [entry, setEntry] = useState<{ key: string; response: BlameResponse | null; now: number } | null>(null)
  // card is the line whose card is open; reveal marks one the palette opened.
  const [card, setCard] = useState<{ key: string; line: number; reveal: boolean } | null>(null)

  useEffect(() => {
    if (!requested) return
    const controller = new AbortController()
    fetchJSON(blameUrl(project, path, at), { signal: controller.signal }, isBlameResponse, (failure) => failureReason(failure)).then(
      (response) => setEntry({ key: documentKey, response, now: Date.now() }),
      () => {
        // Cancelled, or the file has no blame (binary, too large, gone):
        // Source shows none for it.
        if (!controller.signal.aborted) setEntry({ key: documentKey, response: null, now: 0 })
      },
    )
    return () => controller.abort()
  }, [at, documentKey, path, project, requested, text, version])

  const onActiveLine = useCallback((line: number) => {
    setActive({ key: documentKey, line })
    setCard((current) => current?.key === documentKey && current.line === line ? current : null)
  }, [documentKey])

  const lineCount = useMemo(() => splitSourceLines(text).length, [text])
  const response = entry?.key === documentKey ? entry.response : null
  const now = entry?.now ?? 0
  const blame = useMemo((): SourceBlame | undefined => available ? {
    onActiveLine,
    render(line) {
      const shown = response ? lineBlame(response, line, lineCount) : null
      if (!shown) return null
      const open = card?.key === documentKey && card.line === line
      return (
        <InlineBlame blame={shown} now={now} open={open} reveal={open && card.reveal}
          onOpenChange={(next) => setCard(next ? { key: documentKey, line, reveal: false } : null)}
          onOpenCommit={(hash, originalLine) => openReview({ kind: "commit", hash }, true, path,
            originalLine > 0 ? { start: originalLine, side: "additions", end: originalLine, endSide: "additions" } : null)}
          onShowHistory={() => showFileHistory(path)} />
      )
    },
  } : undefined, [available, card, documentKey, lineCount, now, onActiveLine, openReview, path, response, showFileHistory])

  return {
    blame,
    showCard() {
      if (!available || activeLine === null || !response || !lineBlame(response, activeLine, lineCount)) return false
      setCard({ key: documentKey, line: activeLine, reveal: true })
      return true
    },
  }
}
