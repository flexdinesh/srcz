import { useEffect, useMemo, useState } from "react"

import { isDiffResponse, type ChangedFile, type PageData } from "@srcz/contracts"
import { failureReason, fetchJSON } from "../../api/http.ts"
import { diffMarkers, markerSource, wholeMarkers, type ChangeMarker } from "./change-markers.ts"
import { workingCompare } from "./compare.ts"
import { diffUrl } from "./review-diffs.ts"

const none: readonly ChangeMarker[] = []

// useChangeMarkers reads the open Source document's change markers (decision
// 0115): for a file in the Uncommitted change set, one working diff per
// shown text, cancelled when the document, its text, or HEAD (gitVersion)
// moves. file is the page's change set entry. Until a reread's diff lands,
// the last markers for the same file stay, so they don't flicker.
export function useChangeMarkers(project: string, page: PageData, file: ChangedFile | undefined, gitVersion: number): readonly ChangeMarker[] {
  const source = markerSource(page, file)
  const diffFile = source.kind === "diff" ? source.file : null
  const path = diffFile?.path ?? ""
  const oldPath = diffFile?.oldPath ?? ""
  const text = page.source
  // file names the read's file; markers shows only while it is still the
  // page's.
  const [entry, setEntry] = useState<{ file: string; markers: readonly ChangeMarker[] } | null>(null)
  const fileKey = `${project}\n${path}\n${oldPath}`

  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    const changed: ChangedFile = oldPath ? { path, oldPath, status: "renamed" } : { path, status: "modified" }
    fetchJSON(diffUrl(project, workingCompare, changed, false), { signal: controller.signal }, isDiffResponse,
      (failure) => failureReason(failure)).then((diff) => {
      const markers = diffMarkers(diff, text)
      // A diff of other text keeps the last markers; the page's reread asks again.
      if (markers) setEntry({ file: fileKey, markers })
    }, () => {
      // Cancelled, or the file no longer differs (code "unchanged"), or the
      // read failed: Source shows no markers for this file.
      if (!controller.signal.aborted) setEntry({ file: fileKey, markers: none })
    })
    return () => controller.abort()
  }, [fileKey, gitVersion, oldPath, path, project, text])

  const whole = source.kind === "whole"
  const wholeFile = useMemo(() => whole ? wholeMarkers(text) : none, [text, whole])
  if (whole) return wholeFile
  return source.kind === "diff" && entry?.file === fileKey ? entry.markers : none
}
