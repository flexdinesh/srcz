import {
  isFeedbackCompare, type Feedback, type FeedbackStatus, type FeedbackSummary, type FeedbackThread,
} from "@zero/contracts"

export interface NetworkAddress {
  address: string
  family: string
  internal: boolean
}

export type NetworkInterfaces = Readonly<
  Record<string, readonly NetworkAddress[] | undefined>
>

export type Environment = Readonly<Record<string, string | undefined>>

export interface DevServerUrl {
  label: "Local" | "Host" | "Network"
  url: string
}

export interface MockFixture {
  name: string
  status: number
  contentType?: string
  // event streams the fixture as one server-sent event of this name and
  // keeps the response open, as /api/events does.
  event?: string
}

// Maps keep request paths such as "constructor" from hitting prototype keys.
const mockPages: ReadonlyMap<string, string> = new Map([
  ["assets/preview.png", "page-image.json"],
  ["assets/sample.bin", "page-binary.json"],
  ["code/app.js", "page-js.json"],
  ["code/styles.css", "page-css.json"],
  ["config/broken.json", "page-json-broken.json"],
  ["config/settings.json", "page-json.json"],
  ["guides/code-blocks.md", "page-code-blocks.json"],
  ["guides/diagrams.md", "page-diagrams.json"],
  ["guides/getting-started.md", "page-document.json"],
  ["guides/request-flow.mmd", "page-mermaid.json"],
  ["logs/enormous.log", "page-too-large.json"],
  ["logs/huge.log", "page-large.json"],
  ["navigation/greet.go", "page-go.json"],
])

const mockFormats: ReadonlyMap<string, MockFixture> = new Map([
  ["config/broken.json", { name: "format-error.json", status: 422 }],
  ["config/settings.json", { name: "format-settings.json", status: 200 }],
])

const mockRaw: ReadonlyMap<string, MockFixture> = new Map([
  ["assets/preview.png", { name: "raw-preview.png", status: 200, contentType: "image/png" }],
])

// One diff per change in changes.json; other paths are not changes.
const mockDiffs: ReadonlyMap<string, string> = new Map([
  ["assets/sample.bin", "diff-binary.json"],
  ["code/app.js", "diff-added.json"],
  ["code/main.go", "diff-modified.json"],
  ["config/zero.toml", "diff-deleted.json"],
  ["guides/getting-started.md", "diff-renamed.json"],
  ["guides/new-guide.md", "diff-untracked.json"],
  ["notes.txt", "diff-too-large.json"],
  ["notes/hunks.txt", "diff-hunks.json"],
])

// One commit in commits.json lists files; each reuses a diff of its status.
const mockCommit = "3577ec6f1d2e4b8a9c0d7e6f5a4b3c2d1e0f9a8b"
const mockCommitDiffs: ReadonlyMap<string, string> = new Map([
  ["code/app.js", "diff-added.json"],
  ["code/main.go", "diff-modified.json"],
  ["config/zero.toml", "diff-deleted.json"],
  ["guides/getting-started.md", "diff-renamed.json"],
])

// The branch, and the range spanning both commits in commits.json, list the
// same files as mockCommit and reuse its diffs.
const mockRangeFrom = "4f76e9a2b3c4d5e6f708192a3b4c5d6e7f8091a2"

// The branch with uncommitted changes lists changes.json's files, which hold
// the branch's, and reuses the working tree's diffs and stats.
function historyDiffs(params: URLSearchParams): ReadonlyMap<string, string> | undefined {
  if (params.has("commit")) return params.get("commit") === mockCommit ? mockCommitDiffs : undefined
  if (params.has("branch")) return params.get("uncommitted") === "1" ? mockDiffs : mockCommitDiffs
  if (params.has("from") || params.has("to")) return mockRange(params) ? mockCommitDiffs : undefined
  return mockDiffs
}

function mockRange(params: URLSearchParams): boolean {
  return params.get("from") === mockRangeFrom && params.get("to") === mockCommit
}

const notFound: MockFixture = { name: "error-not-found.json", status: 404 }

// Local branches refs.json lists; branch-stack.json stacks the feature ones.
const mockLocalBranches: ReadonlySet<string> = new Set([
  "feature/commit-history",
  "feature/island-layout",
  "feature/review-rail",
  "main",
  "release/0.9",
])

// Bases refs.json lists; another base is unknown. The branch fixtures stay
// the same whichever base is chosen.
const mockBases: ReadonlySet<string> = new Set([
  ...mockLocalBranches,
  "origin/feature/commit-history",
  "origin/main",
  "origin/release/0.9",
])

// mockUnknownBase rejects a base, then a head, refs.json does not list; a
// head must be local. The branch fixtures stay the same whichever is chosen.
function mockUnknownBase(params: URLSearchParams): MockFixture | undefined {
  const base = params.get("base")
  if (base !== null && base !== "" && !mockBases.has(base)) return { name: "error-unknown-base.json", status: 400 }
  const head = params.get("head")
  return head === null || head === "" || mockLocalBranches.has(head) ? undefined : { name: "error-unknown-head.json", status: 400 }
}

// compare-stats.json counts changes.json's files; compare-stats-history.json
// counts the files the mock commit, branch, and range share.
function mockCompareStats(params: URLSearchParams): MockFixture {
  switch (params.get("compare")) {
    case "working":
      return { name: "compare-stats.json", status: 200 }
    case "branch":
      return mockUnknownBase(params)
        ?? { name: params.get("uncommitted") === "1" ? "compare-stats.json" : "compare-stats-history.json", status: 200 }
    case "commit":
      return params.get("commit") === mockCommit ? { name: "compare-stats-history.json", status: 200 } : notFound
    case "range":
      return mockRange(params) ? { name: "compare-stats-history.json", status: 200 } : notFound
    default:
      return notFound
  }
}

export function primaryLanIpv4(
  interfaces: NetworkInterfaces,
): string | undefined {
  for (const addresses of Object.values(interfaces)) {
    for (const candidate of addresses ?? []) {
      if (candidate.family === "IPv4" && !candidate.internal) {
        return candidate.address
      }
    }
  }

  return undefined
}

export function devServerUrls(
  port: number,
  lanAddress: string | undefined,
): readonly DevServerUrl[] {
  const urls: DevServerUrl[] = [
    { label: "Local", url: `http://localhost:${port}/` },
    { label: "Host", url: `http://0.0.0.0:${port}/` },
  ]

  if (lanAddress !== undefined) {
    urls.push({ label: "Network", url: `http://${lanAddress}:${port}/` })
  }

  return urls
}

export function formatDevServerUrl({ label, url }: DevServerUrl): string {
  return `  ➜  ${label}:${" ".repeat(8 - label.length)}${url}`
}

// Unset or empty uses the fallback; anything but a TCP port fails startup.
export function devServerPort(
  environment: Environment,
  name: string,
  fallback: number,
): number {
  const raw = environment[name]

  if (raw === undefined || raw === "") {
    return fallback
  }

  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!(port >= 1 && port <= 65535)) {
    throw new Error(`${name} must be a port from 1 to 65535, got "${raw}"`)
  }

  return port
}

export function isSshSession(environment: Environment): boolean {
  return ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"].some(
    (name) => Boolean(environment[name]),
  )
}

export function shouldOpenBrowser(environment: Environment): boolean {
  return ["dev", "dev:mock"].includes(environment.npm_lifecycle_event ?? "")
    && !isSshSession(environment)
}

export function mockFixtureName(method: string, rawURL: string): MockFixture | undefined {
  if (method !== "GET") return undefined
  const url = new URL(rawURL, "http://localhost")
  switch (url.pathname) {
    case "/metrics":
      return { name: "metrics.json", status: 200 }
    case "/search-documents":
      return { name: "search-documents.json", status: 200 }
    case "/projects":
      return { name: "projects.json", status: 200 }
    case "/directories":
      return { name: "directories.json", status: 200 }
    case "/page": {
      const path = url.searchParams.get("path")
      if (path === null) return { name: "page-index.json", status: 200 }
      // One snapshot: navigation/greet.go at the mock commit.
      if (url.searchParams.has("at")) {
        return path === "navigation/greet.go" && url.searchParams.get("at") === mockCommit
          ? { name: "page-commit.json", status: 200 }
          : { name: "page-missing.json", status: 404 }
      }
      const page = mockPages.get(path)
      return page ? { name: page, status: 200 } : { name: "page-missing.json", status: 404 }
    }
    case "/format":
      return mockFormats.get(url.searchParams.get("path") ?? "") ?? notFound
    case "/raw":
      return mockRaw.get(url.searchParams.get("path") ?? "") ?? notFound
    // One navigation scenario: Format in navigation/greet.go.
    case "/definition":
      return { name: "definition.json", status: 200 }
    case "/references":
      return { name: "references.json", status: 200 }
    case "/navigation-status":
      return { name: "navigation-status.json", status: 200 }
    case "/changes":
      return { name: "changes.json", status: 200 }
    case "/diff": {
      const unknownBase = url.searchParams.has("branch") ? mockUnknownBase(url.searchParams) : undefined
      if (unknownBase) return unknownBase
      const diff = historyDiffs(url.searchParams)?.get(url.searchParams.get("path") ?? "")
      return diff ? { name: diff, status: 200 } : notFound
    }
    case "/commits":
      return mockUnknownBase(url.searchParams)
        ?? { name: url.searchParams.get("range") === "all" ? "commits-all.json" : "commits.json", status: 200 }
    case "/commit-files":
      return url.searchParams.get("commit") === mockCommit ? { name: "commit-files.json", status: 200 } : notFound
    case "/branch-files":
      return mockUnknownBase(url.searchParams)
        ?? { name: url.searchParams.get("uncommitted") === "1" ? "branch-files-uncommitted.json" : "branch-files.json", status: 200 }
    case "/range-files":
      return mockRange(url.searchParams) ? { name: "range-files.json", status: 200 } : notFound
    case "/refs":
      return { name: "refs.json", status: 200 }
    case "/branch-stack":
      return mockUnknownBase(url.searchParams) ?? { name: "branch-stack.json", status: 200 }
    case "/compare-stats":
      return mockCompareStats(url.searchParams)
    // One blame: navigation/greet.go, in the working tree or at the mock commit.
    case "/blame": {
      const at = url.searchParams.get("at")
      return url.searchParams.get("path") === "navigation/greet.go" && (at === null || at === mockCommit)
        ? { name: "blame.json", status: 200 }
        : notFound
    }
    // One walkthrough reads in full; the other is gone.
    case "/walkthroughs":
      return { name: "walkthroughs.json", status: 200 }
    // The mock project is always watched and never changes.
    case "/events":
      return { name: "events-status.json", status: 200, contentType: "text/event-stream", event: "status" }
    case "/walkthrough":
      return url.searchParams.get("id") === "greeting-tour"
        ? { name: "walkthrough-tour.json", status: 200 }
        : { name: "error-walkthrough-unavailable.json", status: 404 }
    default:
      return undefined
  }
}

// MockResponse is an in-memory mock's answer: JSON, or 204 with no body.
export interface MockResponse {
  status: number
  body: string
}

export interface MockFeedbackRequest {
  method: string
  url: string
  body: string
}

function jsonResponse(status: number, value: unknown): MockResponse {
  return { status, body: JSON.stringify(value) }
}

function invalidFeedback(problems: readonly string[]): MockResponse {
  return jsonResponse(400, { error: problems.join("\n"), code: "invalidFeedback" })
}

function escapeHTML(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;")
}

// mockBodyHTML renders a message as paragraphs of escaped text; the server
// renders Markdown.
function mockBodyHTML(body: string): string {
  return body.split(/\n{2,}/).filter((part) => part.trim()).map((part) => `<p>${escapeHTML(part.trim())}</p>\n`).join("")
}

function parseJSONObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null
  } catch {
    return null
  }
}

function awaitingOf(thread: FeedbackThread): FeedbackThread["awaiting"] {
  const last = thread.messages.at(-1)
  if (last?.author === "agent") return "user"
  return thread.status === "open" && last?.author === "user" ? "agent" : "none"
}

function summaryOf(feedback: Feedback): FeedbackSummary {
  const count = (test: (thread: FeedbackThread) => boolean) => feedback.threads.filter(test).length
  return {
    id: feedback.id,
    branch: feedback.branch,
    threads: feedback.threads.length,
    open: count((thread) => thread.status === "open"),
    awaitingAgent: count((thread) => thread.awaiting === "agent"),
    awaitingUser: count((thread) => thread.awaiting === "user"),
    updatedAt: feedback.updatedAt,
  }
}

const mockFeedbackStatuses: ReadonlySet<string> = new Set(["open", "resolved", "wontfix"])

function isMockStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && mockFeedbackStatuses.has(value)
}

// mockFeedbackStore answers the feedback routes from memory for pnpm
// dev:mock (decision 0120), seeded with the fixtures: current is the
// checkout's branch's feedback; listed summarizes other branches', which read
// as empty until written. Locations stay as written; the server resolves them.
export function mockFeedbackStore(current: Feedback, listed: readonly FeedbackSummary[], now: () => string = () => new Date().toISOString()) {
  const store = new Map<string, Feedback>([[current.id, current]])
  const summaries = new Map(listed.filter((summary) => summary.id !== current.id).map((summary): [string, FeedbackSummary] => [summary.id, summary]))
  let currentId = current.id
  const currentBranch = current.branch

  const find = (id: string, project: string): Feedback | null => {
    const found = store.get(id || currentId)
    if (found) return { ...found, project }
    const summary = summaries.get(id)
    if (summary) return { id, project, branch: summary.branch, threads: [], createdAt: summary.updatedAt, updatedAt: summary.updatedAt }
    return id ? null : { id: "", project, branch: currentBranch, threads: [], createdAt: "", updatedAt: "" }
  }
  const save = (feedback: Feedback) => {
    store.set(feedback.id, feedback)
    summaries.delete(feedback.id)
    if (feedback.branch === currentBranch) currentId = feedback.id
  }
  const unavailable = (id: string) => jsonResponse(404, { error: `no feedback ${id} for this repository`, code: "feedbackUnavailable" })

  function createThread(draft: Record<string, unknown>): MockResponse {
    const problems: string[] = []
    const project = typeof draft.project === "string" ? draft.project : ""
    const id = typeof draft.id === "string" ? draft.id : ""
    const path = typeof draft.path === "string" ? draft.path : ""
    const body = typeof draft.body === "string" ? draft.body.trim() : ""
    const side = draft.side === "old" ? "old" : "new"
    const lines = Array.isArray(draft.lines) && draft.lines.length === 2 && draft.lines.every((line) => Number.isSafeInteger(line) && line > 0)
      ? draft.lines.filter((line): line is number => typeof line === "number") : undefined
    if (!project) problems.push("project: is required")
    if (!path) problems.push("path: is required")
    if (!body) problems.push("body: is empty")
    if (draft.lines !== undefined && !lines) problems.push("lines: must be [start, end]")
    if (problems.length > 0) return invalidFeedback(problems)
    const existing = find(id, project)
    if (!existing) return unavailable(id)
    const time = now()
    const compare = isFeedbackCompare(draft.compare) ? draft.compare : undefined
    const thread: FeedbackThread = {
      number: Math.max(0, ...existing.threads.map((entry) => entry.number)) + 1,
      status: "open",
      awaiting: "agent",
      anchor: { path, side, ...(lines ? { lines } : {}), ...(compare ? { compare } : {}) },
      location: { state: "anchored", path, side, ...(lines ? { lines } : {}) },
      messages: [{ number: 1, author: "user", body, bodyHTML: mockBodyHTML(body), createdAt: time }],
      createdAt: time,
      updatedAt: time,
    }
    save({ ...existing, id: existing.id || "fb-mockcu", threads: [...existing.threads, thread], createdAt: existing.createdAt || time, updatedAt: time })
    return jsonResponse(200, thread)
  }

  function postMessage(draft: Record<string, unknown>): MockResponse {
    const project = typeof draft.project === "string" ? draft.project : ""
    const id = typeof draft.id === "string" ? draft.id : ""
    const body = typeof draft.body === "string" ? draft.body.trim() : ""
    const status = isMockStatus(draft.status) ? draft.status : undefined
    const author = draft.author === "agent" ? "agent" : "user"
    if (!body && !status) return invalidFeedback(["body: is empty and no status is set"])
    const existing = id ? find(id, project) : null
    if (!existing) return unavailable(id)
    const target = existing.threads.find((thread) => thread.number === draft.thread)
    if (!target) return invalidFeedback([`thread: feedback ${id} has no thread ${String(draft.thread)}`])
    const time = now()
    const reopen = !status && author === "user" && target.status !== "open"
    const next = status ?? (reopen ? "open" : target.status)
    const message = {
      number: target.messages.length + 1, author, ...(typeof draft.name === "string" && draft.name ? { name: draft.name } : {}),
      body, bodyHTML: mockBodyHTML(body), ...(status ? { status } : {}), createdAt: time,
    } satisfies FeedbackThread["messages"][number]
    const updated: FeedbackThread = { ...target, status: next, messages: [...target.messages, message], updatedAt: time }
    const thread = { ...updated, awaiting: awaitingOf(updated) }
    save({ ...existing, threads: existing.threads.map((entry) => entry.number === thread.number ? thread : entry), updatedAt: time })
    return jsonResponse(200, thread)
  }

  return {
    handle({ body, method, url: rawURL }: MockFeedbackRequest): MockResponse | undefined {
      const url = new URL(rawURL, "http://localhost")
      const params = url.searchParams
      const project = params.get("project") ?? ""
      const id = params.get("id") ?? ""
      switch (`${method} ${url.pathname}`) {
        case "GET /feedback": {
          const feedback = find(id, project)
          return feedback ? jsonResponse(200, feedback) : unavailable(id)
        }
        case "GET /feedback-list":
          return jsonResponse(200, [...[...store.values()].filter((feedback) => feedback.threads.length > 0).map(summaryOf), ...summaries.values()]
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
        case "POST /feedback-threads": {
          const draft = parseJSONObject(body)
          return draft ? createThread(draft) : invalidFeedback(["body: is not a JSON object"])
        }
        case "POST /feedback-messages": {
          const draft = parseJSONObject(body)
          return draft ? postMessage(draft) : invalidFeedback(["body: is not a JSON object"])
        }
        case "DELETE /feedback-threads": {
          const existing = id ? find(id, project) : null
          if (!existing) return unavailable(id)
          save({ ...existing, threads: existing.threads.filter((thread) => String(thread.number) !== params.get("thread")) })
          return { status: 204, body: "" }
        }
        case "DELETE /feedback": {
          if (!id || !(store.delete(id) || summaries.delete(id))) return unavailable(id)
          if (id === currentId) currentId = ""
          return { status: 204, body: "" }
        }
        default:
          return undefined
      }
    },
  }
}

export type MockFeedbackStore = ReturnType<typeof mockFeedbackStore>
