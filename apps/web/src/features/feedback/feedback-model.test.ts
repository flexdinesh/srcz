import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { isFeedback, type Feedback, type FeedbackThread } from "@zero/contracts"
import {
  activity, anchorKey, anchorLabel, authorLabel, feedbackCompare, feedbackMarkdown, feedbackMeta, feedbackPrompt, groupByFile, inlineThreads, isUnseen,
  locationLabel, markSeen, matchesFilter, openCounts, outdatedCount, parseSeen, placeLabel, reviewCompareOf, routeFeedback, statusChange,
  threadPrompt, threadRoute, threadTitle, unseenCount, utcTime,
} from "./feedback-model.ts"

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../../../${path}`, import.meta.url), "utf8")
}

async function fixture(): Promise<Feedback> {
  const value: unknown = JSON.parse(await repositoryFile("testdata/api/default/feedback.json"))
  assert.ok(isFeedback(value))
  return value
}

function thread(feedback: Feedback, number: number): FeedbackThread {
  const found = feedback.threads.find((entry) => entry.number === number)
  assert.ok(found, `thread ${number}`)
  return found
}

test("Markdown export matches the CLI's output for every thread", async () => {
  const feedback = await fixture()
  const expected = await repositoryFile("testdata/feedback/markdown.md")
  assert.equal(feedbackMarkdown(feedback, feedback.threads), expected)
})

test("Markdown fences outlast backtick runs and go bare without a language", async () => {
  const feedback = await fixture()
  const first = thread(feedback, 1)
  const ticks = { ...first, anchor: { ...first.anchor, text: ["const fence = `````"], language: "" } }
  assert.ok(threadPrompt(feedback, ticks).includes("\n``````\nconst fence = `````\n``````\n"))
  const bare = { ...first, anchor: { ...first.anchor, language: undefined } }
  assert.ok(threadPrompt(feedback, bare).includes("code/main.go:7\n```\n"))
  const body = { ...first, messages: first.messages.map((message) => ({ ...message, body: "Trailing  \n\n" })) }
  assert.ok(threadPrompt(feedback, body).endsWith("UTC\nTrailing  \n"))
})

test("Markdown export names empty feedback as the CLI does", async () => {
  const feedback = await fixture()
  assert.equal(feedbackMarkdown({ ...feedback, id: "", threads: [] }, []), "No feedback for branch feature/greeting in /home/user/markdown yet.\n")
  assert.equal(feedbackMarkdown({ ...feedback, id: "", branch: "", threads: [] }, []), "No feedback for detached HEAD in /home/user/markdown yet.\n")
  const closed = feedback.threads.filter((entry) => entry.awaiting !== "agent")
  assert.equal(feedbackMarkdown({ ...feedback, threads: closed }, []),
    "# Feedback fb-3k2q8m\nBranch feature/greeting · /home/user/markdown · no threads awaiting you\n\nNo threads yet.\n")
})

test("location labels follow lines, sides, moves, and outdated text", async () => {
  const feedback = await fixture()
  assert.equal(locationLabel(thread(feedback, 1)), "code/main.go:7")
  assert.equal(locationLabel(thread(feedback, 2)), "code/app.js:4-5 (moved from 2-3)")
  assert.equal(locationLabel(thread(feedback, 3)), "config/zero.toml:4 (old side) · outdated, code no longer present")
  assert.equal(locationLabel(thread(feedback, 4)), "guides/getting-started.md (file)")
  assert.equal(placeLabel(thread(feedback, 2)), "code/app.js:4-5")
  assert.equal(placeLabel(thread(feedback, 3)), "config/zero.toml")
})

test("messages name their author and the status they set", async () => {
  const feedback = await fixture()
  const [question, answer] = thread(feedback, 2).messages
  assert.ok(question && answer)
  assert.equal(authorLabel(question), "you")
  assert.equal(authorLabel(answer), "agent · claude")
  assert.equal(authorLabel({ ...answer, name: undefined }), "agent")
  assert.equal(statusChange("resolved"), "resolved this")
  assert.equal(statusChange("wontfix"), "marked this won't fix")
  assert.equal(statusChange("open"), "reopened this")
  assert.equal(threadTitle(thread(feedback, 1)), "Keep the greeting in a constant so the CLI and tests share it.")
  assert.equal(activity(thread(feedback, 1)), "you commented")
  assert.equal(activity(thread(feedback, 2)), "agent replied")
  assert.equal(activity({ ...thread(feedback, 2), messages: [{ ...answer, body: "" }] }), "agent resolved")
})

test("filters and groups threads by file", async () => {
  const feedback = await fixture()
  const numbers = (filter: Parameters<typeof matchesFilter>[1]) => feedback.threads.filter((entry) => matchesFilter(entry, filter)).map((entry) => entry.number)
  assert.deepEqual(numbers("open"), [1, 3])
  assert.deepEqual(numbers("awaiting"), [1, 3])
  assert.deepEqual(numbers("resolved"), [2, 4])
  assert.deepEqual(numbers("all"), [1, 2, 3, 4])
  assert.deepEqual(groupByFile([...feedback.threads].reverse()).map((group) => [group.path, group.threads.map((entry) => entry.number)]), [
    ["code/app.js", [2]], ["code/main.go", [1]], ["config/zero.toml", [3]], ["guides/getting-started.md", [4]],
  ])
  assert.deepEqual([...openCounts(feedback.threads)], [["code/main.go", 1], ["config/zero.toml", 1]])
})

test("inline threads leave outdated ones to the band, and closed ones to the option", async () => {
  const feedback = await fixture()
  assert.deepEqual(inlineThreads(feedback.threads, "code/app.js", true).map((entry) => entry.number), [2])
  assert.deepEqual(inlineThreads(feedback.threads, "code/app.js", false), [])
  assert.deepEqual(inlineThreads(feedback.threads, "config/zero.toml", true), [])
  assert.equal(outdatedCount(feedback.threads, "config/zero.toml", true), 1)
  assert.equal(outdatedCount(feedback.threads, "code/main.go", true), 0)
})

test("agent replies stay unseen until shown at their version", async () => {
  const feedback = await fixture()
  assert.equal(unseenCount({}, feedback), 2)
  assert.equal(isUnseen({}, feedback.id, thread(feedback, 1)), false)
  const seen = markSeen({}, feedback.id, [thread(feedback, 2)])
  assert.equal(unseenCount(seen, feedback), 1)
  assert.equal(markSeen(seen, feedback.id, [thread(feedback, 2)]), seen)
  const updated = { ...thread(feedback, 2), updatedAt: "2026-11-10T10:00:00Z" }
  assert.equal(isUnseen(seen, feedback.id, updated), true)
  assert.equal(unseenCount(seen, { ...feedback, id: "" }), 0)
  assert.deepEqual(parseSeen(JSON.parse(JSON.stringify(seen))), seen)
  assert.deepEqual(parseSeen({ "fb-3k2q8m": { 2: 5, 3: "x" }, bad: [] }), { "fb-3k2q8m": { 3: "x" } })
  assert.deepEqual(parseSeen(null), {})
})

test("the meta line counts threads, the agent's queue, and new replies", async () => {
  const feedback = await fixture()
  assert.equal(feedbackMeta(feedback, 1), "4 threads · 2 awaiting agent · 1 new reply")
  assert.equal(feedbackMeta(feedback, 2), "4 threads · 2 awaiting agent · 2 new replies")
  assert.equal(feedbackMeta({ ...feedback, threads: [thread(feedback, 2)] }, 0), "1 thread")
})

test("a thread opens its compare's review at its lines, or Source", async () => {
  const feedback = await fixture()
  assert.deepEqual(threadRoute("/p", thread(feedback, 1)), { search: { project: "/p", review: "working" }, hash: "f=code/main.go&R7" })
  assert.deepEqual(threadRoute("/p", thread(feedback, 2)), {
    search: { project: "/p", review: "branch", base: "main", head: "feature/greeting" }, hash: "f=code/app.js&R4-R5",
  })
  assert.equal(threadRoute("/p", thread(feedback, 3)), null)
  // Thread 4 was written on a whole file in Source.
  assert.deepEqual(threadRoute("/p", thread(feedback, 4)), { search: { project: "/p", path: "guides/getting-started.md" }, hash: "" })
  const fileInReview = { ...thread(feedback, 4), anchor: { ...thread(feedback, 4).anchor, compare: thread(feedback, 1).anchor.compare } }
  assert.deepEqual(threadRoute("/p", fileInReview), { search: { project: "/p", review: "working" }, hash: "f=guides/getting-started.md" })
  const old = { ...thread(feedback, 1), location: { state: "anchored" as const, path: "code/main.go", side: "old" as const, lines: [3, 4] } }
  assert.equal(threadRoute("/p", old)?.hash, "f=code/main.go&L3-L4")
  const { compare: _compare, ...sourceAnchor } = thread(feedback, 1).anchor
  assert.deepEqual(threadRoute("/p", { ...thread(feedback, 1), anchor: sourceAnchor }), { search: { project: "/p", path: "code/main.go" }, hash: "L7" })
})

test("compares round-trip between reviews and the contract", () => {
  const hash = "3577ec6f1d2e4b8a9c0d7e6f5a4b3c2d1e0f9a8b"
  for (const compare of [
    { kind: "working" as const },
    { kind: "branch" as const, base: "main", head: "", uncommitted: true },
    { kind: "branch" as const, base: "", head: "feature", uncommitted: false },
    { kind: "commit" as const, hash },
    { kind: "range" as const, from: hash, to: hash },
  ]) {
    assert.deepEqual(reviewCompareOf(feedbackCompare(compare)), compare)
  }
  assert.deepEqual(feedbackCompare({ kind: "branch", base: "", head: "", uncommitted: false }), { kind: "branch", uncommitted: false })
  assert.equal(reviewCompareOf({ kind: "commit", commit: "abc", uncommitted: false }), null)
  const anchor = { path: "a.go", side: "new" as const, lines: [1, 2] as const, compare: feedbackCompare({ kind: "working" }) }
  assert.equal(anchorKey(anchor), anchorKey({ ...anchor }))
  assert.notEqual(anchorKey(anchor), anchorKey({ ...anchor, compare: null }))
  assert.notEqual(anchorKey(anchor), anchorKey({ ...anchor, side: "old" }))
  assert.equal(anchorLabel(anchor), "a.go:1-2")
  assert.equal(anchorLabel({ ...anchor, side: "old", lines: [3, 3] }), "a.go:3 (old)")
  assert.equal(anchorLabel({ ...anchor, lines: null }), "a.go")
})

test("route ids are fb- and six lowercase letters or digits", () => {
  assert.equal(routeFeedback("fb-3k2q8m"), "fb-3k2q8m")
  assert.equal(routeFeedback("fb-018abc"), "fb-018abc")
  for (const value of ["fb-3K2Q8M", "fb-3k2q8", "fb-3k2q8m1", "fb-3k2q8_", "fb-3k2q8m\n", 3, undefined]) assert.equal(routeFeedback(value), undefined)
})

test("Copy Prompt names the CLI's commands and flags, and HTTP only for http origins", () => {
  const input = { origin: "http://127.0.0.1:8080", project: "/home/user/markdown", id: "fb-3k2q8m", branch: "feature/greeting" }
  assert.equal(feedbackPrompt(input), `Address review feedback fb-3k2q8m on branch feature/greeting in /home/user/markdown.
Read the threads waiting on you: zero feedback show fb-3k2q8m
(--json for structure, --all for every thread).
For each thread, make the change, then reply:
  zero feedback reply fb-3k2q8m <thread> -m "<what you changed>" --resolve
Decline with --wontfix -m "<why>", or ask a question with -m "<question>" and no status.
To raise something new: zero feedback comment fb-3k2q8m --path <path> --lines <start>-<end> -m "<text>"
Without the zero CLI: GET http://127.0.0.1:8080/api/feedback?project=%2Fhome%2Fuser%2Fmarkdown&id=fb-3k2q8m
and reply with POST http://127.0.0.1:8080/api/feedback-messages, JSON {"project","id","thread","body","status","author":"agent"}.
`)
  for (const origin of ["zero://local", null]) {
    const prompt = feedbackPrompt({ ...input, origin })
    assert.ok(!prompt.includes("Without the zero CLI"))
    assert.ok(!prompt.includes("/api/"))
  }
  assert.ok(feedbackPrompt({ ...input, branch: "" }).startsWith("Address review feedback fb-3k2q8m on a detached HEAD in"))

  // Every subcommand and flag the prompt names is one `zero feedback` takes
  // (decision 0120): show [--json --all], reply (-m, --resolve, --wontfix),
  // comment (--path, --lines, -m).
  const commands = feedbackPrompt(input).match(/zero feedback \w+/g) ?? []
  assert.deepEqual([...new Set(commands)], ["zero feedback show", "zero feedback reply", "zero feedback comment"])
  const flags = new Set(feedbackPrompt(input).match(/(?<![\w-])--?[a-z]+/g) ?? [])
  assert.deepEqual([...flags].sort(), ["--all", "--json", "--lines", "--path", "--resolve", "--wontfix", "-m"])
})

test("Copy Thread for Agent leads the thread's Markdown with how to reply", async () => {
  const feedback = await fixture()
  const prompt = threadPrompt(feedback, thread(feedback, 1))
  assert.equal(prompt.split("\n")[0], 'Feedback fb-3k2q8m thread 1 in /home/user/markdown. Reply with: zero feedback reply fb-3k2q8m 1 -m "…" [--resolve | --wontfix]')
  assert.ok(prompt.includes("## Thread 1 · open · code/main.go:7\n```go\n"))
})

test("times read in UTC to the minute", () => {
  assert.equal(utcTime("2026-11-10T09:12:59Z"), "2026-11-10 09:12 UTC")
  assert.equal(utcTime("2026-11-10T20:12:00+11:00"), "2026-11-10 09:12 UTC")
  assert.equal(utcTime("not a time"), "not a time")
})
