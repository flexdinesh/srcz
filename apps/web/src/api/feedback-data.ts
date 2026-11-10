import {
  isFeedback, isFeedbackSummary, isFeedbackThread,
  type Feedback, type FeedbackAuthor, type FeedbackCompare, type FeedbackSide, type FeedbackStatus, type FeedbackSummary, type FeedbackThread,
} from "@zero/contracts"

import { deleteResource, failureReason, fetchJSON, postJSON, RequestError, type RequestFailure } from "./http.ts"

// Transport for review feedback threads (decision 0120). Reads validate with
// the generated guards; the write bodies are Go-only request shapes
// (pkg/contract/requests.go), kept aligned here by hand.

// feedbackUnavailableCode marks a 404 for an id the repository lacks.
export const feedbackUnavailableCode = "feedbackUnavailable"

// FeedbackThreadDraft is POST /api/feedback-threads (contract.FeedbackThreadDraft).
export interface FeedbackThreadDraft {
  project: string
  id?: string
  compare?: FeedbackCompare
  path: string
  side?: FeedbackSide
  lines?: [number, number]
  body: string
  author?: FeedbackAuthor
  name?: string
}

// FeedbackMessageDraft is POST /api/feedback-messages (contract.FeedbackMessageDraft).
export interface FeedbackMessageDraft {
  project: string
  id: string
  thread: number
  body?: string
  status?: FeedbackStatus
  author?: FeedbackAuthor
  name?: string
}

// FeedbackQuery names one branch's feedback: id, or else the compare's head
// branch, or else HEAD's. compare is what locations resolve against.
export interface FeedbackQuery {
  project: string
  id: string
  compare: FeedbackCompare | null
}

// compareParams adds a compare as /api/compare-stats takes it.
export function compareParams(params: URLSearchParams, compare: FeedbackCompare): void {
  params.set("compare", compare.kind)
  if (compare.base) params.set("base", compare.base)
  if (compare.head) params.set("head", compare.head)
  if (compare.uncommitted) params.set("uncommitted", "1")
  if (compare.commit) params.set("commit", compare.commit)
  if (compare.from) params.set("from", compare.from)
  if (compare.to) params.set("to", compare.to)
}

export function feedbackUrl({ compare, id, project }: FeedbackQuery): string {
  const params = new URLSearchParams({ project })
  if (id) params.set("id", id)
  if (compare) compareParams(params, compare)
  return `/api/feedback?${params.toString()}`
}

function isFeedbackSummaries(value: unknown): value is FeedbackSummary[] {
  return Array.isArray(value) && value.every(isFeedbackSummary)
}

// isFeedbackMissing reports a read of an id the repository no longer has.
export function isFeedbackMissing(error: unknown): boolean {
  return error instanceof RequestError && error.failure.kind === "rejected" && error.failure.code === feedbackUnavailableCode
}

export function fetchFeedback(query: FeedbackQuery, signal: AbortSignal): Promise<Feedback> {
  return fetchJSON(feedbackUrl(query), { signal }, isFeedback, (failure) => `Couldn't read feedback: ${failureReason(failure)}.`)
}

export function fetchFeedbackList(project: string, signal: AbortSignal): Promise<FeedbackSummary[]> {
  const url = `/api/feedback-list?${new URLSearchParams({ project }).toString()}`
  return fetchJSON(url, { signal }, isFeedbackSummaries, (failure) => `Couldn't list feedback: ${failureReason(failure)}.`)
}

function writeError(action: string): (failure: RequestFailure) => string {
  return (failure) => `Couldn't ${action}: ${failureReason(failure)}.`
}

export function createFeedbackThread(draft: FeedbackThreadDraft): Promise<FeedbackThread> {
  return postJSON("/api/feedback-threads", draft, {}, isFeedbackThread, writeError("add the comment"))
}

export function postFeedbackMessage(draft: FeedbackMessageDraft): Promise<FeedbackThread> {
  return postJSON("/api/feedback-messages", draft, {}, isFeedbackThread, writeError(draft.body ? "send the reply" : "update the thread"))
}

export function deleteFeedbackThread(project: string, id: string, thread: number): Promise<void> {
  const url = `/api/feedback-threads?${new URLSearchParams({ project, id, thread: String(thread) }).toString()}`
  return deleteResource(url, {}, writeError("delete the thread"))
}

export function deleteFeedback(project: string, id: string): Promise<void> {
  const url = `/api/feedback?${new URLSearchParams({ project, id }).toString()}`
  return deleteResource(url, {}, writeError("delete the feedback"))
}
