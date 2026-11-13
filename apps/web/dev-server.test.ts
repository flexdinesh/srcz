import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { isErrorResponse, isFeedback, isFeedbackSummary, isFeedbackThread, type Feedback, type FeedbackSummary } from "@zero/contracts"

import {
  devServerPort,
  devServerUrls,
  formatDevServerUrl,
  mockFeedbackStore,
  mockFixtureName,
  primaryLanIpv4,
  shouldOpenBrowser,
} from "./dev-server.ts"

test("primaryLanIpv4 returns only the first external IPv4 address", () => {
  assert.equal(
    primaryLanIpv4({
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wifi: [
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "192.168.1.25", family: "IPv4", internal: false },
      ],
      vpn: [{ address: "10.0.0.2", family: "IPv4", internal: false }],
    }),
    "192.168.1.25",
  )
})

test("primaryLanIpv4 returns undefined without an external IPv4 address", () => {
  assert.equal(
    primaryLanIpv4({
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wifi: [{ address: "fe80::1", family: "IPv6", internal: false }],
    }),
    undefined,
  )
})

test("devServerUrls uses the selected port and at most one LAN address", () => {
  assert.deepEqual(devServerUrls(5174, "192.168.1.25"), [
    { label: "Local", url: "http://localhost:5174/" },
    { label: "Host", url: "http://0.0.0.0:5174/" },
    { label: "Network", url: "http://192.168.1.25:5174/" },
  ])
  assert.deepEqual(devServerUrls(5174, undefined), [
    { label: "Local", url: "http://localhost:5174/" },
    { label: "Host", url: "http://0.0.0.0:5174/" },
  ])
})

test("devServerPort reads a port or falls back when unset or empty", () => {
  assert.equal(devServerPort({}, "ZERO_DEV_WEB_PORT", 5173), 5173)
  assert.equal(devServerPort({ ZERO_DEV_WEB_PORT: "" }, "ZERO_DEV_WEB_PORT", 5173), 5173)
  assert.equal(devServerPort({ ZERO_DEV_WEB_PORT: "5199" }, "ZERO_DEV_WEB_PORT", 5173), 5199)
  assert.equal(devServerPort({ ZERO_DEV_WEB_PORT: "1" }, "ZERO_DEV_WEB_PORT", 5173), 1)
  assert.equal(devServerPort({ ZERO_DEV_WEB_PORT: "65535" }, "ZERO_DEV_WEB_PORT", 5173), 65535)
})

test("devServerPort rejects values that are not TCP ports", () => {
  for (const raw of ["0", "65536", "-1", "80.5", " 80", "0x50", "1e3", "abc"]) {
    assert.throws(
      () => devServerPort({ ZERO_DEV_WEB_PORT: raw }, "ZERO_DEV_WEB_PORT", 5173),
      { message: `ZERO_DEV_WEB_PORT must be a port from 1 to 65535, got "${raw}"` },
    )
  }
})

test("formatDevServerUrl aligns startup labels", () => {
  assert.equal(
    formatDevServerUrl({ label: "Local", url: "http://localhost:5173/" }),
    "  ➜  Local:   http://localhost:5173/",
  )
  assert.equal(
    formatDevServerUrl({ label: "Network", url: "http://192.168.1.25:5173/" }),
    "  ➜  Network: http://192.168.1.25:5173/",
  )
})

test("shouldOpenBrowser permits only frontend dev lifecycles outside SSH", () => {
  assert.equal(shouldOpenBrowser({ npm_lifecycle_event: "dev" }), true)
  assert.equal(shouldOpenBrowser({ npm_lifecycle_event: "dev:mock" }), true)
  assert.equal(
    shouldOpenBrowser({ npm_lifecycle_event: "dev", SSH_TTY: "" }),
    true,
  )
  assert.equal(shouldOpenBrowser({ npm_lifecycle_event: "test:browser" }), false)
  assert.equal(shouldOpenBrowser({}), false)

  for (const sshVariable of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]) {
    assert.equal(
      shouldOpenBrowser({
        npm_lifecycle_event: "dev",
        [sshVariable]: "active",
      }),
      false,
    )
  }
})

test("mockFixtureName maps supported API scenarios", () => {
  assert.deepEqual(mockFixtureName("GET", "/page"), {
    name: "page-index.json",
    status: 200,
  })
  assert.deepEqual(
    mockFixtureName("GET", "/page?path=guides%2Fgetting-started.md"),
    { name: "page-document.json", status: 200 },
  )
  assert.deepEqual(mockFixtureName("GET", "/page?path=missing.md"), {
    name: "page-missing.json",
    status: 404,
  })
  assert.deepEqual(mockFixtureName("GET", "/page?path=assets%2Fsample.bin"), {
    name: "page-binary.json",
    status: 200,
  })
  assert.deepEqual(mockFixtureName("GET", "/page?path=logs%2Fenormous.log"), {
    name: "page-too-large.json",
    status: 200,
  })
  assert.deepEqual(mockFixtureName("GET", "/format?path=config%2Fsettings.json"), {
    name: "format-settings.json",
    status: 200,
  })
  assert.deepEqual(mockFixtureName("GET", "/format?path=config%2Fbroken.json"), {
    name: "format-error.json",
    status: 422,
  })
  assert.deepEqual(mockFixtureName("GET", "/events?project=."), {
    name: "events-status.json", status: 200, contentType: "text/event-stream", event: "status",
  })
  assert.deepEqual(mockFixtureName("GET", "/page?path=navigation%2Fgreet.go"), { name: "page-go.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/page?path=navigation%2Fgreet.go&at=3577ec6f1d2e4b8a9c0d7e6f5a4b3c2d1e0f9a8b"), { name: "page-commit.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/page?path=guides%2Fgetting-started.md&at=3577ec6f1d2e4b8a9c0d7e6f5a4b3c2d1e0f9a8b"), { name: "page-missing.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", "/definition?path=navigation%2Fgreet.go&line=6&column=8"), { name: "definition.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/references?path=navigation%2Fgreet.go&line=6&column=8"), { name: "references.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/navigation-status?path=navigation%2Fgreet.go"), { name: "navigation-status.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/raw?path=assets%2Fpreview.png"), {
    name: "raw-preview.png",
    status: 200,
    contentType: "image/png",
  })
  assert.deepEqual(mockFixtureName("GET", "/raw?path=guides%2Fgetting-started.md"), {
    name: "error-not-found.json",
    status: 404,
  })
  for (const endpoint of ["page", "format", "raw"]) {
    for (const key of ["constructor", "__proto__", "toString"]) {
      assert.equal(mockFixtureName("GET", `/${endpoint}?path=${key}`)?.status, 404, `${endpoint} ${key}`)
    }
  }
  assert.deepEqual(mockFixtureName("GET", "/changes?project=%2Fwork"), { name: "changes.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/blame?project=%2Fwork&path=navigation%2Fgreet.go"), { name: "blame.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/blame?path=navigation%2Fgreet.go&at=3577ec6f1d2e4b8a9c0d7e6f5a4b3c2d1e0f9a8b"), { name: "blame.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/blame?path=code%2Fapp.js"), { name: "error-not-found.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", "/diff?project=%2Fwork&path=code%2Fmain.go"), { name: "diff-modified.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/diff?path=config%2Fzero.toml"), { name: "diff-deleted.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/diff?path=guides%2Fnew-guide.md"), { name: "diff-untracked.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/diff?path=guides%2Fmissing.md"), { name: "error-not-found.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", "/diff?path=constructor"), { name: "error-not-found.json", status: 404 })
  const commit = "3577ec6f1d2e4b8a9c0d7e6f5a4b3c2d1e0f9a8b"
  assert.deepEqual(mockFixtureName("GET", "/commits?project=%2Fwork&range=branch"), { name: "commits.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/commits?project=%2Fwork&range=all"), { name: "commits-all.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/commit-files?commit=${commit}`), { name: "commit-files.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/commit-files?commit=${"0".repeat(40)}`), { name: "error-not-found.json", status: 404 })
  const from = "4f76e9a2b3c4d5e6f708192a3b4c5d6e7f8091a2"
  assert.deepEqual(mockFixtureName("GET", "/branch-files?project=%2Fwork"), { name: "branch-files.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/range-files?from=${from}&to=${commit}`), { name: "range-files.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/range-files?from=${commit}&to=${from}`), { name: "error-not-found.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", "/diff?path=code%2Fmain.go&branch=1"), { name: "diff-modified.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/diff?path=code%2Fmain.go&from=${from}&to=${commit}`), { name: "diff-modified.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/diff?path=code%2Fmain.go&from=${from}`), { name: "error-not-found.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", `/diff?path=code%2Fmain.go&commit=${commit}`), { name: "diff-modified.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/diff?path=guides%2Fnew-guide.md&commit=${commit}`), { name: "error-not-found.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", `/diff?path=code%2Fmain.go&commit=${"0".repeat(40)}`), { name: "error-not-found.json", status: 404 })
  const unknownBase = { name: "error-unknown-base.json", status: 400 }
  assert.deepEqual(mockFixtureName("GET", "/refs?project=%2Fwork"), { name: "refs.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/commits?range=branch&base=origin%2Fmain"), { name: "commits.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/commits?range=branch&base=missing"), unknownBase)
  assert.deepEqual(mockFixtureName("GET", "/branch-files?base=release%2F0.9"), { name: "branch-files.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/branch-files?base=constructor"), unknownBase)
  assert.deepEqual(mockFixtureName("GET", "/diff?path=code%2Fmain.go&branch=1&base=main"), { name: "diff-modified.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/diff?path=code%2Fmain.go&branch=1&base=missing"), unknownBase)
  assert.deepEqual(mockFixtureName("GET", "/walkthroughs?project=%2Fwork"), { name: "walkthroughs.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/walkthrough?project=%2Fwork&id=greeting-tour"), { name: "walkthrough-tour.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/walkthrough?project=%2Fwork&id=zero-hello"), { name: "error-walkthrough-unavailable.json", status: 404 })
  assert.deepEqual(mockFixtureName("DELETE", "/walkthroughs?project=%2Fwork&id=greeting-tour"), undefined)
  assert.deepEqual(mockFixtureName("GET", "/compare-stats?compare=working"), { name: "compare-stats.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/compare-stats?compare=branch&base=main"), { name: "compare-stats-history.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/compare-stats?compare=branch&base=missing"), unknownBase)
  const unknownHead = { name: "error-unknown-head.json", status: 400 }
  assert.deepEqual(mockFixtureName("GET", "/branch-stack?project=%2Fwork"), { name: "branch-stack.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/branch-stack?base=missing"), unknownBase)
  assert.deepEqual(mockFixtureName("GET", "/branch-files?base=feature%2Fisland-layout&head=feature%2Freview-rail"),
    { name: "branch-files.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/branch-files?head=origin%2Fmain"), unknownHead)
  assert.deepEqual(mockFixtureName("GET", "/compare-stats?compare=branch&head=missing"), unknownHead)
  assert.deepEqual(mockFixtureName("GET", `/compare-stats?compare=commit&commit=${commit}`), { name: "compare-stats-history.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", `/compare-stats?compare=commit&commit=${from}`), { name: "error-not-found.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", `/compare-stats?compare=range&from=${from}&to=${commit}`), { name: "compare-stats-history.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/compare-stats?compare=everything"), { name: "error-not-found.json", status: 404 })
  assert.deepEqual(mockFixtureName("GET", "/projects"), { name: "projects.json", status: 200 })
  assert.deepEqual(mockFixtureName("GET", "/directories?path=zero"), { name: "directories.json", status: 200 })
  assert.equal(mockFixtureName("POST", "/page"), undefined)
  assert.equal(mockFixtureName("GET", "/unknown"), undefined)
})

function feedbackFixtures(): { current: Feedback, listed: FeedbackSummary[] } {
  const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../testdata/api/default/${name}`, import.meta.url), "utf8"))
  const current = read("feedback.json")
  const listed = read("feedback-list.json")
  assert.ok(isFeedback(current))
  assert.ok(Array.isArray(listed) && listed.every(isFeedbackSummary))
  return { current, listed: listed.filter(isFeedbackSummary) }
}

function feedbackStore() {
  const { current, listed } = feedbackFixtures()
  return mockFeedbackStore(current, listed, () => "2026-11-10T12:00:00Z")
}

function answer(store: ReturnType<typeof feedbackStore>, method: string, url: string, body: unknown = undefined) {
  const response = store.handle({ method, url, body: body === undefined ? "" : JSON.stringify(body) })
  assert.ok(response)
  const value: unknown = response.body ? JSON.parse(response.body) : undefined
  return { status: response.status, value }
}

const feedbackProject = "project=%2Fhome%2Fuser%2Fmarkdown"

test("mock feedback reads the checkout's branch, lists, and rejects unknown ids", () => {
  const store = feedbackStore()
  const current = answer(store, "GET", `/feedback?${feedbackProject}&base=main`)
  assert.equal(current.status, 200)
  assert.ok(isFeedback(current.value))
  assert.equal(current.value.id, "fb-3k2q8m")
  assert.equal(current.value.threads.length, 4)

  const listed = answer(store, "GET", `/feedback-list?${feedbackProject}`)
  assert.ok(Array.isArray(listed.value) && listed.value.every(isFeedbackSummary))
  assert.deepEqual(listed.value.map((summary) => summary.id), ["fb-3k2q8m", "fb-7h4n2p"])

  const other = answer(store, "GET", `/feedback?${feedbackProject}&id=fb-7h4n2p`)
  assert.ok(isFeedback(other.value))
  assert.equal(other.value.branch, "main")

  const missing = answer(store, "GET", `/feedback?${feedbackProject}&id=fb-zzzzzz`)
  assert.equal(missing.status, 404)
  assert.ok(isErrorResponse(missing.value))
  assert.equal(missing.value.code, "feedbackUnavailable")
  assert.equal(store.handle({ method: "GET", url: "/feedbacks", body: "" }), undefined)
})

test("mock feedback starts threads, replies, resolves, and reopens", () => {
  const store = feedbackStore()
  const started = answer(store, "POST", "/feedback-threads", {
    project: "/home/user/markdown", id: "fb-3k2q8m", path: "code/app.js", side: "new", lines: [1, 2], body: "Use <strong>",
  })
  assert.equal(started.status, 200)
  assert.ok(isFeedbackThread(started.value))
  assert.equal(started.value.number, 5)
  assert.equal(started.value.awaiting, "agent")
  assert.deepEqual(started.value.location.lines, [1, 2])
  assert.equal(started.value.messages[0]?.bodyHTML, "<p>Use &lt;strong&gt;</p>\n")

  const replied = answer(store, "POST", "/feedback-messages", { project: "/home/user/markdown", id: "fb-3k2q8m", thread: 5, body: "Done.", author: "agent", name: "codex" })
  assert.ok(isFeedbackThread(replied.value))
  assert.equal(replied.value.awaiting, "user")
  assert.equal(replied.value.messages[1]?.name, "codex")

  const resolved = answer(store, "POST", "/feedback-messages", { project: "/home/user/markdown", id: "fb-3k2q8m", thread: 5, status: "resolved" })
  assert.ok(isFeedbackThread(resolved.value))
  assert.equal(resolved.value.status, "resolved")
  assert.equal(resolved.value.awaiting, "none")

  const reopened = answer(store, "POST", "/feedback-messages", { project: "/home/user/markdown", id: "fb-3k2q8m", thread: 5, body: "Not quite." })
  assert.ok(isFeedbackThread(reopened.value))
  assert.equal(reopened.value.status, "open")
  assert.equal(reopened.value.awaiting, "agent")

  const read = answer(store, "GET", `/feedback?${feedbackProject}&id=fb-3k2q8m`)
  assert.ok(isFeedback(read.value))
  assert.equal(read.value.threads.at(-1)?.messages.length, 4)
  assert.equal(read.value.updatedAt, "2026-11-10T12:00:00Z")
})

test("mock feedback rejects invalid drafts", () => {
  const store = feedbackStore()
  const empty = answer(store, "POST", "/feedback-threads", { project: "/home/user/markdown", path: "code/app.js", body: " " })
  assert.equal(empty.status, 400)
  assert.ok(isErrorResponse(empty.value))
  assert.equal(empty.value.code, "invalidFeedback")
  assert.equal(answer(store, "POST", "/feedback-messages", { project: "/home/user/markdown", id: "fb-3k2q8m", thread: 99, body: "x" }).status, 400)
  assert.equal(store.handle({ method: "POST", url: "/feedback-threads", body: "[" })?.status, 400)
})

test("mock feedback deletes a thread, then the feedback", () => {
  const store = feedbackStore()
  assert.equal(answer(store, "DELETE", `/feedback-threads?${feedbackProject}&id=fb-3k2q8m&thread=1`).status, 204)
  const read = answer(store, "GET", `/feedback?${feedbackProject}`)
  assert.ok(isFeedback(read.value))
  assert.deepEqual(read.value.threads.map((thread) => thread.number), [2, 3, 4])

  assert.equal(answer(store, "DELETE", `/feedback?${feedbackProject}&id=fb-3k2q8m`).status, 204)
  assert.equal(answer(store, "DELETE", `/feedback?${feedbackProject}&id=fb-3k2q8m`).status, 404)
  const fresh = answer(store, "GET", `/feedback?${feedbackProject}`)
  assert.ok(isFeedback(fresh.value))
  assert.equal(fresh.value.id, "")
  assert.deepEqual(fresh.value.threads, [])
})
