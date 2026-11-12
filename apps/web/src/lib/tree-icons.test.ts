import assert from "node:assert/strict"
import test from "node:test"

import { createFileTreeIconResolver } from "@pierre/trees"

import { treeIcons } from "./tree-icons.ts"

const { resolveIcon } = createFileTreeIconResolver(treeIcons)

test("folder slots resolve to symbols the sprite sheet defines", () => {
  const slots: readonly ["file-tree-icon-folder", "file-tree-icon-folder-open"] = ["file-tree-icon-folder", "file-tree-icon-folder-open"]
  for (const slot of slots) {
    const icon = resolveIcon(slot)
    assert.equal(icon.remappedFrom, slot)
    assert.ok(treeIcons.spriteSheet?.includes(`<symbol id="${icon.name}"`), `${slot} draws ${icon.name}`)
  }
  assert.notEqual(resolveIcon("file-tree-icon-folder").name, resolveIcon("file-tree-icon-folder-open").name)
})

test("files keep Pierre's colored built-in icons", () => {
  assert.equal(resolveIcon("file-tree-icon-file", "src/App.tsx").token, "react")
  assert.equal(resolveIcon("file-tree-icon-file", "README.md").token, "markdown")
})

test("the chevron stays Pierre's", () => {
  assert.equal(resolveIcon("file-tree-icon-chevron").remappedFrom, undefined)
})
