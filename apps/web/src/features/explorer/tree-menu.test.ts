import assert from "node:assert/strict"
import test from "node:test"

import { absolutePath, isTreeMenuAction, treeMenuItems, treeRowPath } from "./tree-menu.ts"

function ids(items: ReturnType<typeof treeMenuItems>): string[] {
  return items.map((item) => "separator" in item ? "-" : item.id)
}

test("file rows offer Show File History; Reveal shows where offered", () => {
  assert.deepEqual(ids(treeMenuItems({ file: true, reveal: true })),
    ["file-history", "-", "reveal", "-", "copy-path", "copy-relative-path"])
  assert.deepEqual(ids(treeMenuItems({ file: true, reveal: false })), ["file-history", "-", "copy-path", "copy-relative-path"])
  assert.deepEqual(ids(treeMenuItems({ file: false, reveal: true })), ["reveal", "-", "copy-path", "copy-relative-path"])
  assert.deepEqual(ids(treeMenuItems({ file: false, reveal: false })), ["copy-path", "copy-relative-path"])
})

test("every menu id is a known action", () => {
  for (const id of ids(treeMenuItems({ file: true, reveal: true })).filter((id) => id !== "-")) assert.equal(isTreeMenuAction(id), true)
  for (const id of [null, "", "close"]) assert.equal(isTreeMenuAction(id), false)
})

test("row paths drop a directory's trailing slash and join the project", () => {
  assert.equal(treeRowPath("src/"), "src")
  assert.equal(treeRowPath("src/a.ts"), "src/a.ts")
  assert.equal(absolutePath("/home/me/alpha", "src/a.ts"), "/home/me/alpha/src/a.ts")
  assert.equal(absolutePath("/", "a.ts"), "/a.ts")
})
