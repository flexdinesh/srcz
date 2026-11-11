import assert from "node:assert/strict"
import test from "node:test"

import { buttonTitle, historyKey, historyMenuDelta, historyMenuItems, mouseDirection, shortcutLabel, type KeyPress } from "./history-controls.ts"
import type { HistoryEntry } from "./navigation-history.ts"

const press = (code: string, modifiers: Partial<KeyPress> = {}, key = code): KeyPress =>
  ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers })

const entry = (label: string, project = "/work/zero"): HistoryEntry =>
  ({ index: 0, key: "k", href: "/", project, label, title: label, visited: 1 })

test("browsers take VS Code's Back and Forward keys", () => {
  assert.equal(historyKey(press("Minus", { ctrlKey: true, altKey: true }), false, false), -1)
  assert.equal(historyKey(press("Minus", { ctrlKey: true, shiftKey: true }), false, false), 1)
  assert.equal(historyKey(press("Minus", { ctrlKey: true }), false, false), null)
  assert.equal(historyKey(press("Minus", { ctrlKey: true }), true, false), -1)
  assert.equal(historyKey(press("Minus", { ctrlKey: true, shiftKey: true }), true, false), 1)
  assert.equal(historyKey(press("Minus", { ctrlKey: true, altKey: true }), true, false), null)
  assert.equal(historyKey(press("Minus", { metaKey: true }), true, false), null)
  // A browser moves with its own Alt+Left.
  assert.equal(historyKey(press("ArrowLeft", { altKey: true }), false, false), null)
})

test("the desktop app adds the browser's keys; its Go menu owns VS Code's", () => {
  assert.equal(historyKey(press("Minus", { ctrlKey: true, altKey: true }), false, true), null)
  assert.equal(historyKey(press("ArrowLeft", { altKey: true }), false, true), -1)
  assert.equal(historyKey(press("ArrowRight", { altKey: true }), false, true), 1)
  assert.equal(historyKey(press("ArrowLeft", { altKey: true, shiftKey: true }), false, true), null)
  assert.equal(historyKey(press("BracketLeft", { metaKey: true }, "["), true, true), -1)
  assert.equal(historyKey(press("BracketRight", { metaKey: true }, "]"), true, true), 1)
  assert.equal(historyKey(press("BracketLeft", { metaKey: true }, "["), false, true), null)
})

test("mouse side buttons move", () => {
  assert.equal(mouseDirection(3), -1)
  assert.equal(mouseDirection(4), 1)
  assert.equal(mouseDirection(0), null)
})

test("tooltips name the destination and the key", () => {
  assert.equal(buttonTitle(-1, { delta: -1, entry: entry("tsconfig.json") }, "/work/zero", false), "Back to tsconfig.json (Ctrl+Alt+-)")
  assert.equal(buttonTitle(1, { delta: 1, entry: entry("main.go", "/work/other") }, "/work/zero", true), `Forward to main.go in other (${shortcutLabel(1, true)})`)
  assert.equal(buttonTitle(-1, undefined, "/work/zero", false), "No earlier location")
  assert.equal(buttonTitle(1, undefined, "/work/zero", false), "No later location")
})

test("menu items round-trip their step", () => {
  const items = historyMenuItems([{ delta: -1, entry: entry("a.md") }, { delta: -2, entry: null }], "/work/zero")
  assert.deepEqual(items, [{ id: "history:-1", label: "a.md" }, { id: "history:-2", label: "an earlier location" }])
  assert.equal(historyMenuDelta("history:-2"), -2)
  assert.equal(historyMenuDelta("history:0"), null)
  assert.equal(historyMenuDelta("close"), null)
  assert.equal(historyMenuDelta(null), null)
})
