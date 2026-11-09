import assert from "node:assert/strict"
import test from "node:test"

import { defaultDiffOptions, diffOptionsModified, effectiveDiffStyle, parseDiffOptions, type DiffOptions } from "./diff-options.ts"

test("stored diff options keep valid values and default the rest", () => {
  assert.deepEqual(parseDiffOptions(null), defaultDiffOptions)
  assert.deepEqual(parseDiffOptions(["unified"]), defaultDiffOptions)
  assert.deepEqual(parseDiffOptions({ style: "unified", wrap: true, ignoreWhitespace: true, inline: "char", expandUnchanged: true }),
    { style: "unified", wrap: true, ignoreWhitespace: true, inline: "char", expandUnchanged: true })
  assert.deepEqual(parseDiffOptions({ style: "stacked", wrap: "yes", inline: "line", expandUnchanged: 1 }), defaultDiffOptions)
  assert.deepEqual(parseDiffOptions({ inline: "none" }), { ...defaultDiffOptions, inline: "none" })
})

test("narrow windows force Unified without forgetting Split", () => {
  const split: DiffOptions = { ...defaultDiffOptions, style: "split" }
  assert.equal(effectiveDiffStyle(split, false), "split")
  assert.equal(effectiveDiffStyle(split, true), "unified")
  assert.equal(effectiveDiffStyle({ ...split, style: "unified" }, false), "unified")
})

test("View options read as changed only when a menu choice leaves its default", () => {
  assert.equal(diffOptionsModified(defaultDiffOptions), false)
  // The layout has its own control on the bar.
  assert.equal(diffOptionsModified({ ...defaultDiffOptions, style: "unified" }), false)
  assert.equal(diffOptionsModified({ ...defaultDiffOptions, wrap: true }), true)
  assert.equal(diffOptionsModified({ ...defaultDiffOptions, ignoreWhitespace: true }), true)
  assert.equal(diffOptionsModified({ ...defaultDiffOptions, inline: "none" }), true)
  assert.equal(diffOptionsModified({ ...defaultDiffOptions, expandUnchanged: true }), true)
})
