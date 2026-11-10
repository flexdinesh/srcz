import type { SelectionSide } from "@pierre/diffs"

import type { Feedback, FeedbackCompare, FeedbackMessage, FeedbackSide, FeedbackStatus, FeedbackThread } from "@zero/contracts"
import { isCommitHash } from "../../lib/commit-hash.ts"
import { lineAnchor } from "../../lib/line-selection.ts"
import { branchCompare, compareKey, compareSearch, reviewFragment, workingCompare, type Compare, type CompareSearch } from "../source-control/compare.ts"

// Pure model of review feedback threads (decision 0120): where a new thread
// anchors, how threads are labelled, grouped, filtered, and opened, which
// agent replies this browser has not seen, and the text copied for agents.
// The Markdown export matches `zero feedback show`'s output.

// FeedbackAnchorInput is where a new thread goes: lines of one side of a
// compare, or of the working tree in Source (compare null). lines is an
// inclusive, 1-based [start, end], null for the whole file.
export interface FeedbackAnchorInput {
  path: string
  side: FeedbackSide
  lines: readonly [number, number] | null
  compare: FeedbackCompare | null
}

// anchorKey identifies an anchor, for drafts kept across reopening.
export function anchorKey(anchor: FeedbackAnchorInput): string {
  const compare = anchor.compare ? reviewCompareOf(anchor.compare) : null
  return JSON.stringify([anchor.path, anchor.side, anchor.lines, compare ? compareKey(compare) : anchor.compare?.kind ?? ""])
}

// feedbackCompare names a review's compare as the feedback contract does.
export function feedbackCompare(compare: Compare): FeedbackCompare {
  switch (compare.kind) {
    case "working":
      return { kind: "working", uncommitted: false }
    case "branch":
      return {
        kind: "branch",
        ...(compare.base ? { base: compare.base } : {}),
        ...(compare.head ? { head: compare.head } : {}),
        uncommitted: compare.uncommitted,
      }
    case "commit":
      return { kind: "commit", commit: compare.hash, uncommitted: false }
    case "range":
      return { kind: "range", from: compare.from, to: compare.to, uncommitted: false }
  }
}

// reviewCompareOf maps a thread's compare back to the review that shows it;
// null when its hashes are not full.
export function reviewCompareOf(compare: FeedbackCompare): Compare | null {
  switch (compare.kind) {
    case "working":
      return workingCompare
    case "branch":
      return branchCompare(compare.base ?? "", compare.head ?? "", compare.uncommitted)
    case "commit":
      return isCommitHash(compare.commit) ? { kind: "commit", hash: compare.commit } : null
    case "range":
      return isCommitHash(compare.from) && isCommitHash(compare.to) ? { kind: "range", from: compare.from, to: compare.to } : null
  }
}

// diffSide is the Pierre side a feedback side's lines sit on.
export function diffSide(side: FeedbackSide): SelectionSide {
  return side === "old" ? "deletions" : "additions"
}

// lineRange reads an inclusive [start, end]; anything else is no lines.
export function lineRange(lines: readonly number[] | undefined): readonly [number, number] | null {
  const start = lines?.[0]
  const end = lines?.[1]
  return lines?.length === 2 && start !== undefined && end !== undefined ? [start, end] : null
}

export const statusLabels: Readonly<Record<FeedbackStatus, string>> = { open: "Open", resolved: "Resolved", wontfix: "Won't fix" }

// closed threads collapse inline and hide with Show resolved comments off.
export function isClosed(status: FeedbackStatus): boolean {
  return status !== "open"
}

function span(lines: readonly [number, number]): string {
  return lines[0] === lines[1] ? String(lines[0]) : `${lines[0]}-${lines[1]}`
}

// locationLabel is a thread's place as the CLI prints it: "code/main.go:7",
// with " (old side)", " (moved from 38-40)", and " · outdated, code no longer
// present" as they apply; "path (file)" for a whole file.
export function locationLabel(thread: FeedbackThread): string {
  const { anchor, location } = thread
  const outdated = location.state === "outdated" ? " · outdated, code no longer present" : ""
  const anchored = lineRange(anchor.lines)
  if (!anchored) return `${location.path} (file)${outdated}`
  const lines = lineRange(location.lines) ?? anchored
  const old = location.side === "old" ? " (old side)" : ""
  const moved = location.state === "moved" && span(lines) !== span(anchored) ? ` (moved from ${span(anchored)})` : ""
  return `${location.path}:${span(lines)}${old}${moved}${outdated}`
}

// anchorLabel names where a new thread goes: "a.go:7", "a.go:4-5 (old)", or
// the path for a whole file.
export function anchorLabel(anchor: FeedbackAnchorInput): string {
  if (!anchor.lines) return anchor.path
  return `${anchor.path}:${span(anchor.lines)}${anchor.side === "old" ? " (old)" : ""}`
}

// placeLabel is a thread's place for the UI: "code/main.go:7", "a.go:4-5
// (old)", or the path alone for a whole file or outdated lines.
export function placeLabel(thread: FeedbackThread): string {
  const lines = lineRange(thread.location.lines)
  if (!lines) return thread.location.path
  return `${thread.location.path}:${span(lines)}${thread.location.side === "old" ? " (old)" : ""}`
}

// authorLabel names a message's writer: you, agent, or agent · name.
export function authorLabel(message: FeedbackMessage): string {
  if (message.author === "user") return "you"
  return message.name ? `agent · ${message.name}` : "agent"
}

// statusChange is the muted line a status-setting message adds.
export function statusChange(status: FeedbackStatus): string {
  if (status === "resolved") return "resolved this"
  if (status === "wontfix") return "marked this won't fix"
  return "reopened this"
}

// firstLine is a message's first non-blank line.
export function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
}

// threadTitle is the first line of a thread's first message.
export function threadTitle(thread: FeedbackThread): string {
  return firstLine(thread.messages[0]?.body ?? "") || "No message"
}

// lastAuthor names who wrote a thread's last message.
export function lastAuthor(thread: FeedbackThread): string {
  const last = thread.messages.at(-1)
  return last ? authorLabel(last) : ""
}

// activity says what last happened in a thread: "agent replied", "you
// commented", "agent resolved".
export function activity(thread: FeedbackThread): string {
  const last = thread.messages.at(-1)
  if (!last) return ""
  const who = last.author === "agent" ? "agent" : "you"
  if (last.status && !last.body.trim()) return `${who} ${last.status === "open" ? "reopened" : last.status === "resolved" ? "resolved" : "declined"}`
  if (last.author === "user") return thread.messages.length === 1 ? "you commented" : "you replied"
  return "agent replied"
}

export type FeedbackFilter = "open" | "awaiting" | "resolved" | "all"

export const filterChoices: ReadonlyArray<{ value: FeedbackFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "awaiting", label: "Awaiting agent" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
]

export function isFeedbackFilter(value: unknown): value is FeedbackFilter {
  return value === "open" || value === "awaiting" || value === "resolved" || value === "all"
}

// matchesFilter: Open is every open thread, Awaiting agent the open ones
// whose last word is the user's, Resolved every closed one.
export function matchesFilter(thread: FeedbackThread, filter: FeedbackFilter): boolean {
  if (filter === "open") return thread.status === "open"
  if (filter === "awaiting") return thread.awaiting === "agent"
  if (filter === "resolved") return isClosed(thread.status)
  return true
}

export interface FileGroup {
  path: string
  threads: FeedbackThread[]
}

// groupByFile groups threads under their current path, paths in order and
// threads by number.
export function groupByFile(threads: readonly FeedbackThread[]): FileGroup[] {
  const groups = new Map<string, FeedbackThread[]>()
  for (const thread of [...threads].sort((left, right) => left.number - right.number)) {
    const group = groups.get(thread.location.path)
    if (group) group.push(thread)
    else groups.set(thread.location.path, [thread])
  }
  return [...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([path, grouped]) => ({ path, threads: grouped }))
}

// openCounts counts each file's open threads, for the Files rail.
export function openCounts(threads: readonly FeedbackThread[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const thread of threads) {
    if (thread.status === "open") counts.set(thread.location.path, (counts.get(thread.location.path) ?? 0) + 1)
  }
  return counts
}

// outdatedCount counts a file's outdated threads, shown or not.
export function outdatedCount(threads: readonly FeedbackThread[], path: string, showResolved: boolean): number {
  return threads.filter((thread) => thread.location.path === path && thread.location.state === "outdated"
    && (showResolved || !isClosed(thread.status))).length
}

// inlineThreads are the threads a review or Source shows in path: anchored
// or moved there, closed ones only while shown.
export function inlineThreads(threads: readonly FeedbackThread[], path: string, showResolved: boolean): FeedbackThread[] {
  return threads.filter((thread) => thread.location.path === path && thread.location.state !== "outdated"
    && (showResolved || !isClosed(thread.status)))
}

// FeedbackSeen is what this browser has seen, as zero-feedback-seen stores
// it: feedback id, then thread number, to the thread's updatedAt.
export type FeedbackSeen = Readonly<Record<string, Readonly<Record<string, string>>>>

export const seenStorageKey = "zero-feedback-seen"

// seenLimit bounds the remembered feedback ids; the oldest go first.
const seenLimit = 100

export function parseSeen(value: unknown): FeedbackSeen {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const seen: Record<string, Record<string, string>> = {}
  for (const [id, threads] of Object.entries(value)) {
    if (typeof threads !== "object" || threads === null || Array.isArray(threads)) continue
    const entry: Record<string, string> = {}
    for (const [number, updatedAt] of Object.entries(threads)) {
      if (typeof updatedAt === "string") entry[number] = updatedAt
    }
    seen[id] = entry
  }
  return seen
}

// isUnseen is an agent reply this browser has not shown.
export function isUnseen(seen: FeedbackSeen, id: string, thread: FeedbackThread): boolean {
  return thread.awaiting === "user" && seen[id]?.[String(thread.number)] !== thread.updatedAt
}

export function unseenCount(seen: FeedbackSeen, feedback: Feedback | null): number {
  if (!feedback?.id) return 0
  return feedback.threads.filter((thread) => isUnseen(seen, feedback.id, thread)).length
}

// markSeen records threads as seen at their updatedAt; seen itself when
// nothing changes.
export function markSeen(seen: FeedbackSeen, id: string, threads: readonly FeedbackThread[]): FeedbackSeen {
  if (!id) return seen
  const current = seen[id] ?? {}
  const changed = threads.filter((thread) => current[String(thread.number)] !== thread.updatedAt)
  if (changed.length === 0) return seen
  const entry = { ...current, ...Object.fromEntries(changed.map((thread) => [String(thread.number), thread.updatedAt])) }
  const { [id]: _previous, ...rest } = seen
  const kept = Object.entries(rest).slice(-(seenLimit - 1))
  return { ...Object.fromEntries(kept), [id]: entry }
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`
}

// feedbackMeta reads "4 threads · 2 awaiting agent · 1 new reply".
export function feedbackMeta(feedback: Feedback, unseen: number): string {
  const awaiting = feedback.threads.filter((thread) => thread.awaiting === "agent").length
  return [
    plural(feedback.threads.length, "thread"),
    awaiting > 0 ? `${awaiting.toLocaleString()} awaiting agent` : "",
    unseen > 0 ? `${unseen.toLocaleString()} new ${unseen === 1 ? "reply" : "replies"}` : "",
  ].filter(Boolean).join(" · ")
}

// branchLabel names a feedback's branch; detached HEAD has none.
export function branchLabel(branch: string): string {
  return branch || "detached HEAD"
}

export type ThreadSearch = (CompareSearch & { project: string }) | { project: string; path: string }

export interface ThreadRoute {
  search: ThreadSearch
  hash: string
}

// threadRoute opens a thread where it was written: its compare's review at
// the file and lines (#f=<path>&R7-R9, L for the old side), or Source at its
// lines. Outdated threads have no lines to open; null.
export function threadRoute(project: string, thread: FeedbackThread): ThreadRoute | null {
  const { anchor, location } = thread
  if (location.state === "outdated") return null
  const lines = lineRange(location.lines)
  const compare = anchor.compare ? reviewCompareOf(anchor.compare) : null
  if (anchor.compare) {
    if (!compare) return null
    const side = diffSide(location.side)
    return {
      search: { project, ...compareSearch(compare) },
      hash: reviewFragment(location.path, lines ? { start: lines[0], end: lines[1], side, endSide: side } : null),
    }
  }
  return { search: { project, path: location.path }, hash: lines ? lineAnchor({ start: lines[0], end: lines[1] }) : "" }
}

// Feedback ids are fb- and six lowercase letters or digits; new ones use
// base32's, but reads accept any, as the server does.
const feedbackIdPattern = /^fb-[a-z0-9]{6}$/

// routeFeedback reads the fb=<id> route parameter.
export function routeFeedback(value: unknown): string | undefined {
  return typeof value === "string" && feedbackIdPattern.test(value) ? value : undefined
}

export interface FeedbackPromptInput {
  // origin is shareableOrigin's; only http(s) origins take HTTP requests.
  origin: string | null
  project: string
  id: string
  branch: string
}

// feedbackPrompt is what Copy Prompt copies: how an agent reads the threads
// waiting on it and answers each with `zero feedback`. An origin that takes
// no HTTP requests leaves the HTTP fallback out, as walkthrough instructions
// do (decision 0049).
export function feedbackPrompt({ branch, id, origin, project }: FeedbackPromptInput): string {
  const where = branch ? `on branch ${branch}` : "on a detached HEAD"
  const http = origin !== null && /^https?:\/\//.test(origin)
    ? `Without the zero CLI: GET ${origin}/api/feedback?${new URLSearchParams({ project, id }).toString()}
and reply with POST ${origin}/api/feedback-messages, JSON {"project","id","thread","body","status","author":"agent"}.
`
    : ""
  return `Address review feedback ${id} ${where} in ${project}.
Read the threads waiting on you: zero feedback show ${id}
(--json for structure, --all for every thread).
For each thread, make the change, then reply:
  zero feedback reply ${id} <thread> -m "<what you changed>" --resolve
Decline with --wontfix -m "<why>", or ask a question with -m "<question>" and no status.
To raise something new: zero feedback comment ${id} --path <path> --lines <start>-<end> -m "<text>"
${http}`
}

// LanguageOf names a path's highlight language for Markdown fences, "" for
// none.
export type LanguageOf = (path: string) => string

function two(value: number): string {
  return String(value).padStart(2, "0")
}

// utcTime reads an RFC 3339 time as "2026-11-10 09:12 UTC".
export function utcTime(time: string): string {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return time
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC`
}

const markdownStatus: Readonly<Record<FeedbackStatus, string>> = { open: "open", resolved: "resolved", wontfix: "won't fix" }
const messageStatus: Readonly<Record<FeedbackStatus, string>> = { open: "reopened", resolved: "resolved", wontfix: "won't fix" }

function messageMarkdown(message: FeedbackMessage): string {
  const author = message.author === "user" ? "**user**" : message.name ? `**agent (${message.name})**` : "**agent**"
  const header = `${author} · ${utcTime(message.createdAt)}${message.status ? ` · ${messageStatus[message.status]}` : ""}`
  const body = message.body.trimEnd()
  return body ? `${header}\n${body}` : header
}

// threadMarkdown is one thread as `zero feedback show` prints it: heading,
// the anchored text fenced in its language, then each message, a blank line
// between messages.
export function threadMarkdown(thread: FeedbackThread, languageOf: LanguageOf): string {
  const parts = [`## Thread ${thread.number} · ${markdownStatus[thread.status]} · ${locationLabel(thread)}`]
  const text = thread.anchor.text ?? []
  if (lineRange(thread.anchor.lines) && text.length > 0) parts.push(`\`\`\`${languageOf(thread.anchor.path)}\n${text.join("\n")}\n\`\`\``)
  parts.push(thread.messages.map(messageMarkdown).join("\n\n"))
  return parts.join("\n")
}

// feedbackMarkdown is `zero feedback show`'s Markdown for threads of
// feedback: a heading, the branch, project, and how many threads await the
// agent, the reply command, then each thread.
export function feedbackMarkdown(feedback: Feedback, threads: readonly FeedbackThread[], languageOf: LanguageOf): string {
  const awaiting = feedback.threads.filter((thread) => thread.awaiting === "agent").length
  const branch = feedback.branch ? `Branch ${feedback.branch}` : "Detached HEAD"
  const head = `# Feedback ${feedback.id}
${branch} · ${feedback.project} · ${plural(awaiting, "thread")} awaiting you

Reply: zero feedback reply ${feedback.id} <thread> -m "<what you did>" [--resolve | --wontfix]`
  return `${[head, ...threads.map((thread) => threadMarkdown(thread, languageOf))].join("\n\n")}\n`
}

// threadPrompt is what a thread's Copy Thread for Agent copies.
export function threadPrompt(feedback: Feedback, thread: FeedbackThread, languageOf: LanguageOf): string {
  return `Feedback ${feedback.id} thread ${thread.number} in ${feedback.project}. Reply with: zero feedback reply ${feedback.id} ${thread.number} -m "…" [--resolve | --wontfix]

${threadMarkdown(thread, languageOf)}
`
}

// noLanguage leaves fences unlabelled: the contract names no language.
export const noLanguage: LanguageOf = () => ""
