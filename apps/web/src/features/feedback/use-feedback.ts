import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { Feedback, FeedbackCompare, FeedbackStatus, FeedbackSummary, FeedbackThread } from "@zero/contracts"
import {
  createFeedbackThread, deleteFeedback, deleteFeedbackThread, fetchFeedback, fetchFeedbackList, isFeedbackMissing, postFeedbackMessage,
} from "../../api/feedback-data.ts"
import { isAbort } from "../../api/http.ts"
import type { FeedbackAnchorInput } from "./feedback-model.ts"

export type FeedbackLoad =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "missing" }
  | { kind: "error"; message: string }

export interface FeedbackOptions {
  project: string
  // id names the feedback; "" reads the compare's head branch's, else HEAD's.
  id: string
  // compare is what locations resolve against; null for the working tree.
  compare: FeedbackCompare | null
  // version rereads when it changes: a feedback event, a change on disk, or
  // a write elsewhere on the page.
  version: number
  enabled: boolean
  // onChanged reports a write, so other readers on the page reread.
  onChanged(): void
}

// FeedbackSession is one branch's feedback and the writes on it, shared by
// review and Source thread zones and the Feedback view.
export interface FeedbackSession {
  load: FeedbackLoad
  // feedback is the last read, kept while it rereads; null before one.
  feedback: Feedback | null
  retry(): void
  // start opens a thread with its first message at anchor.
  start(anchor: FeedbackAnchorInput, body: string): Promise<FeedbackThread>
  // reply adds a message, a status change, or both.
  reply(thread: number, body: string, status?: FeedbackStatus): Promise<FeedbackThread>
  removeThread(thread: number): Promise<void>
  removeFeedback(): Promise<void>
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// withThread replaces or appends a thread the server returned.
function withThread(feedback: Feedback, thread: FeedbackThread): Feedback {
  const exists = feedback.threads.some((entry) => entry.number === thread.number)
  return {
    ...feedback,
    threads: exists ? feedback.threads.map((entry) => entry.number === thread.number ? thread : entry) : [...feedback.threads, thread],
    updatedAt: thread.updatedAt,
  }
}

// useFeedback reads one branch's feedback (decision 0120) and writes to it.
// Writes update the threads in place, then ask the page to reread.
export function useFeedback({ compare, enabled, id, onChanged, project, version }: FeedbackOptions): FeedbackSession {
  const key = useMemo(() => JSON.stringify([project, id, compare]), [compare, id, project])
  const [state, setState] = useState<{ key: string; load: FeedbackLoad; last: Feedback | null }>({ key: "", load: { kind: "idle" }, last: null })
  const [attempt, setAttempt] = useState(0)
  const query = useRef({ project, id, compare })
  useEffect(() => { query.current = { project, id, compare } })

  useEffect(() => {
    if (!enabled || !project) return
    const controller = new AbortController()
    setState((previous) => previous.key === key && previous.last ? previous : { key, load: { kind: "loading" }, last: null })
    fetchFeedback(query.current, controller.signal).then((feedback) => {
      setState({ key, load: { kind: "ready" }, last: feedback })
    }, (error: unknown) => {
      if (isAbort(error)) return
      const load: FeedbackLoad = isFeedbackMissing(error) ? { kind: "missing" } : { kind: "error", message: message(error, "Couldn't read feedback.") }
      setState((previous) => ({ key, load, last: previous.key === key && load.kind === "error" ? previous.last : null }))
    })
    return () => controller.abort()
  }, [attempt, enabled, key, project, version])

  const current = state.key === key ? state : null
  const feedback = enabled ? current?.last ?? null : null
  const latest = useRef(feedback)
  useEffect(() => { latest.current = feedback })
  const changed = useRef(onChanged)
  useEffect(() => { changed.current = onChanged })

  const apply = useCallback((thread: FeedbackThread) => {
    setState((previous) => previous.key === key && previous.last ? { ...previous, last: withThread(previous.last, thread) } : previous)
    changed.current()
    return thread
  }, [key])

  const start = useCallback(async (anchor: FeedbackAnchorInput, body: string) => {
    const known = latest.current?.id || query.current.id
    const thread = await createFeedbackThread({
      project: query.current.project,
      ...(known ? { id: known } : {}),
      ...(anchor.compare ? { compare: anchor.compare } : {}),
      path: anchor.path,
      side: anchor.side,
      ...(anchor.lines ? { lines: [anchor.lines[0], anchor.lines[1]] } : {}),
      body,
    })
    return apply(thread)
  }, [apply])

  const reply = useCallback(async (thread: number, body: string, status?: FeedbackStatus) => {
    const known = latest.current?.id || query.current.id
    const updated = await postFeedbackMessage({
      project: query.current.project, id: known, thread, ...(body ? { body } : {}), ...(status ? { status } : {}),
    })
    return apply(updated)
  }, [apply])

  const removeThread = useCallback(async (thread: number) => {
    const known = latest.current?.id || query.current.id
    await deleteFeedbackThread(query.current.project, known, thread)
    setState((previous) => previous.key === key && previous.last
      ? { ...previous, last: { ...previous.last, threads: previous.last.threads.filter((entry) => entry.number !== thread) } }
      : previous)
    changed.current()
  }, [key])

  const removeFeedback = useCallback(async () => {
    const known = latest.current?.id || query.current.id
    if (!known) return
    await deleteFeedback(query.current.project, known)
    changed.current()
  }, [])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const load: FeedbackLoad = !enabled ? { kind: "idle" } : current?.load ?? { kind: "loading" }
  return { load, feedback, retry, start, reply, removeThread, removeFeedback }
}

export interface FeedbackList {
  result: FeedbackSummary[] | null
  error: string
}

// useFeedbackList lists the repository's feedback, one per branch, while
// wanted, again whenever version changes.
export function useFeedbackList(project: string, wanted: boolean, version: number): FeedbackList {
  const [state, setState] = useState<FeedbackList & { project: string }>({ project: "", result: null, error: "" })
  useEffect(() => {
    if (!wanted || !project) return
    const controller = new AbortController()
    fetchFeedbackList(project, controller.signal).then((result) => setState({ project, result, error: "" }), (error: unknown) => {
      if (isAbort(error)) return
      setState((previous) => ({ ...previous, project, error: message(error, "Couldn't list feedback.") }))
    })
    return () => controller.abort()
  }, [project, version, wanted])
  return state.project === project ? { result: state.result, error: state.error } : { result: null, error: "" }
}
