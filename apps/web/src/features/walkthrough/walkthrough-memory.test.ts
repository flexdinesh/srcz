import assert from "node:assert/strict"
import test from "node:test"

import {
  emptyWalkthroughMemory, isNew, parseWalkthroughMemory, progressOf, rememberFinished, rememberOpened, rememberSeen, rememberStep,
  rememberVisited, unseenCount,
} from "./walkthrough-memory.ts"

test("memory parses defensively", () => {
  assert.deepEqual(parseWalkthroughMemory(null), emptyWalkthroughMemory)
  assert.deepEqual(parseWalkthroughMemory({
    seen: { "/p": "2026-10-26T00:00:00Z", "/q": 3 },
    steps: { "/p": { tour: 2, bad: -1, worse: "x" } },
    progress: { "/p": { tour: { updatedAt: "t", visited: [3, 1, 1, -2, 1.5, 999, "x"], finished: true }, bad: { visited: [1] } } },
  }), {
    seen: { "/p": "2026-10-26T00:00:00Z" },
    steps: { "/p": { tour: 2 } },
    progress: { "/p": { tour: { updatedAt: "t", visited: [1, 3], finished: true } } },
  })
})

test("progress belongs to one version of a walkthrough", () => {
  let memory = emptyWalkthroughMemory
  assert.equal(isNew(memory, "/p", "tour", "v1"), true)
  memory = rememberOpened(memory, "/p", "tour", "v1")
  assert.equal(isNew(memory, "/p", "tour", "v1"), false)
  assert.equal(rememberOpened(memory, "/p", "tour", "v1"), memory)
  memory = rememberVisited(memory, "/p", "tour", "v1", 2)
  memory = rememberVisited(memory, "/p", "tour", "v1", 0)
  assert.equal(rememberVisited(memory, "/p", "tour", "v1", 2), memory)
  memory = rememberFinished(memory, "/p", "tour", "v1")
  assert.deepEqual(progressOf(memory, "/p", "tour", "v1"), { updatedAt: "v1", visited: [0, 2], finished: true })
  assert.equal(rememberFinished(memory, "/p", "tour", "v1"), memory)
  // Republishing starts over.
  assert.equal(isNew(memory, "/p", "tour", "v2"), true)
  assert.deepEqual(progressOf(memory, "/p", "tour", "v2"), { updatedAt: "v2", visited: [], finished: false })
  memory = rememberVisited(memory, "/p", "tour", "v2", 1)
  assert.deepEqual(progressOf(memory, "/p", "tour", "v2"), { updatedAt: "v2", visited: [1], finished: false })
})

test("remembering puts the latest first and bounds the lists", () => {
  let memory = emptyWalkthroughMemory
  for (let index = 0; index < 120; index++) memory = rememberStep(memory, "/p", `w${index}`, index)
  const ids = Object.keys(memory.steps["/p"] ?? {})
  assert.equal(ids.length, 100)
  assert.equal(ids[0], "w119")
  memory = rememberStep(memory, "/p", "w50", 7)
  assert.equal(Object.keys(memory.steps["/p"] ?? {})[0], "w50")
  assert.equal(memory.steps["/p"]?.w50, 7)
  const seen = rememberSeen(memory, "/p", "t")
  assert.equal(seen.seen["/p"], "t")
  assert.equal(rememberSeen(seen, "/p", "t"), seen)
})

test("unseen counts walkthroughs newer than the last seen", () => {
  const times = ["2026-10-26T10:00:00Z", "2026-10-26T09:00:00Z", "2026-10-25T09:00:00Z"]
  assert.equal(unseenCount(times, undefined), 3)
  assert.equal(unseenCount(times, "2026-10-26T09:00:00Z"), 1)
  assert.equal(unseenCount(times, "2026-10-26T10:00:00Z"), 0)
})
