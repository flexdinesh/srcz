import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { Walkthrough } from "@srcz/contracts"
import {
  isNew, progressOf, readWalkthroughMemory, rememberFinished, rememberOpened, rememberSeen, rememberStep, rememberVisited, unseenCount,
  writeWalkthroughMemory, type WalkthroughMemory, type WalkthroughProgress,
} from "./walkthrough-memory.ts"
import { coverRoute, parseStep, stepAfter, stepRoute, type StepPosition, type StepRoute } from "./walkthrough-steps.ts"
import { useWalkthrough, useWalkthroughs, type WalkthroughDetail } from "./use-walkthroughs.ts"

interface SessionOptions {
  project: string
  // routeId and routeStep are the route's wt and step parameters.
  routeId: string
  routeStep: number | undefined
  // viewShown is set while the Walkthroughs view is visible.
  viewShown: boolean
  // go opens a route; focusDocument moves focus to the document.
  go(route: StepRoute, focusDocument: boolean): void
  // leave opens the route's own target without the walkthrough.
  leave(): void
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable=true]") !== null)
}

// useWalkthroughSession owns which walkthrough the user follows and where
// (decision 0047). The route's wt and step place the narration; leaving the
// route keeps the walkthrough selected, so Next resumes from the last step.
// Ctrl/Cmd+Right and Ctrl/Cmd+Left step while one is selected.
export function useWalkthroughSession({ project, routeId, routeStep, viewShown, go, leave }: SessionOptions) {
  const list = useWalkthroughs(project)
  const [memory, setMemory] = useState<WalkthroughMemory>(readWalkthroughMemory)
  const update = useCallback((change: (current: WalkthroughMemory) => WalkthroughMemory) => {
    setMemory((current) => {
      const next = change(readWalkthroughMemory())
      if (next !== current) writeWalkthroughMemory(next)
      return next
    })
  }, [])
  const [chosen, setChosen] = useState("")
  // The route's walkthrough becomes the selected one.
  const [followed, setFollowed] = useState(routeId)
  if (routeId !== followed) {
    setFollowed(routeId)
    if (routeId) setChosen(routeId)
  }
  const selectedId = routeId || chosen
  const summary = list.result?.find((entry) => entry.id === selectedId)
  const { detail, retry } = useWalkthrough(project, selectedId, summary?.updatedAt ?? "")
  const walkthrough = detail.kind === "ready" ? detail.walkthrough : null
  const count = walkthrough?.steps.length ?? 0
  const routed = routeId !== "" && routeId === selectedId
  const remembered = memory.steps[project]?.[selectedId]
  const position: StepPosition = routed
    ? parseStep(routeStep, count)
    : remembered !== undefined && remembered < count ? remembered : null

  // Opening a walkthrough clears its New mark; each step opened joins its
  // read steps, kept per browser for this version (decision 0113).
  const updatedAt = walkthrough?.updatedAt ?? ""
  useEffect(() => {
    if (!updatedAt) return
    update((current) => rememberOpened(current, project, selectedId, updatedAt))
  }, [project, selectedId, update, updatedAt])
  useEffect(() => {
    if (!routed || position === null || !updatedAt) return
    update((current) => rememberVisited(rememberStep(current, project, selectedId, position), project, selectedId, updatedAt, position))
  }, [position, project, routed, selectedId, update, updatedAt])
  const progress = progressOf(memory, project, selectedId, updatedAt)
  const visited = useMemo(() => new Set(progress.visited), [progress.visited])
  // resume is where an unfinished walkthrough was left, past its first step.
  const resume: StepPosition = !progress.finished && remembered !== undefined && remembered > 0 && remembered < count ? remembered : null

  // The view marks every listed walkthrough seen while it shows.
  const newest = list.result?.[0]?.updatedAt
  useEffect(() => {
    if (viewShown && newest) update((current) => rememberSeen(current, project, newest))
  }, [newest, project, update, viewShown])
  const unseen = useMemo(() => unseenCount((list.result ?? []).map((entry) => entry.updatedAt), memory.seen[project]), [list.result, memory.seen, project])

  const goTo = useCallback((target: StepPosition, focusDocument = true) => {
    if (!walkthrough) return
    const step = target === null ? undefined : walkthrough.steps[target]
    go(target === null || !step ? coverRoute(project, walkthrough.id) : stepRoute(project, walkthrough.id, target, step), focusDocument)
  }, [go, project, walkthrough])
  const move = useCallback((direction: 1 | -1) => {
    const next = stepAfter(position, count, direction)
    if (next !== undefined) goTo(next)
  }, [count, goTo, position])

  // finish marks the walkthrough read and shows its cover's completion card
  // (decision 0113).
  const [finished, setFinished] = useState("")
  const finish = useCallback(() => {
    if (!walkthrough) return
    update((current) => rememberFinished(current, project, walkthrough.id, walkthrough.updatedAt))
    setFinished(walkthrough.id)
    go(coverRoute(project, walkthrough.id), true)
  }, [go, project, update, walkthrough])
  // advance is Next, or Finish on the last step.
  const advance = useCallback(() => {
    if (stepAfter(position, count, 1) !== undefined) move(1)
    else if (position !== null && position === count - 1) finish()
  }, [count, finish, move, position])
  const justFinished = finished !== "" && finished === selectedId && routed && position === null

  // open shows a walkthrough's cover, or resumes it where the user left off.
  const open = useCallback((id: string) => {
    setChosen(id)
    go(coverRoute(project, id), false)
  }, [go, project])
  // close returns the view to the list; the route keeps its target.
  const close = useCallback(() => {
    setChosen("")
    if (routeId) leave()
  }, [leave, routeId])

  const keys = useRef({ move, advance, active: walkthrough !== null })
  useEffect(() => { keys.current = { move, advance, active: walkthrough !== null } })
  useEffect(() => {
    const step = (event: KeyboardEvent) => {
      if (!keys.current.active || event.defaultPrevented || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
      if (isTextField(event.target)) return
      event.preventDefault()
      if (event.key === "ArrowRight") keys.current.advance()
      else keys.current.move(-1)
    }
    document.addEventListener("keydown", step)
    return () => document.removeEventListener("keydown", step)
  }, [])

  const entries = list.result
  // isNewEntry is whether a listed walkthrough's version was never opened;
  // progressFor is what was read of it.
  const isNewEntry = useCallback((id: string, at: string) => isNew(memory, project, id, at), [memory, project])
  const progressFor = useCallback((id: string, at: string): WalkthroughProgress => progressOf(memory, project, id, at), [memory, project])
  // nextUnread is the newest other walkthrough not yet opened, for the
  // completion card.
  const nextUnread = entries?.find((entry) => entry.id !== selectedId && isNew(memory, project, entry.id, entry.updatedAt)) ?? null

  return {
    list,
    unseen,
    isNewEntry,
    progressFor,
    nextUnread,
    selectedId,
    detail: selectedId ? detail : { kind: "none" } satisfies WalkthroughDetail,
    retry,
    walkthrough,
    // routed is set while the route follows the selected walkthrough.
    routed,
    position,
    visited,
    finished: progress.finished,
    justFinished,
    resume,
    canMove: (direction: 1 | -1) => stepAfter(position, count, direction) !== undefined,
    goTo,
    move,
    advance,
    finish,
    open,
    close,
  }
}

export type WalkthroughSession = ReturnType<typeof useWalkthroughSession>
export type { Walkthrough }
