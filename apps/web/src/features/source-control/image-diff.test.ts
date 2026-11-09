import assert from "node:assert/strict"
import test from "node:test"

import type { DiffResponse, DiffSide, FileType } from "@srcz/contracts"
import {
  clampPercent, imageDiffModes, imageMeta, imageSides, imageUrl, maxImageBytes, pointerPercent, stageLayout, swipeClip,
} from "./image-diff.ts"

const png: FileType = {
  id: "png", label: "PNG", extensions: [".png"], filenames: [], language: "",
  previewKind: "image", previewLabel: "Preview", defaultMode: "preview", formattable: false,
}
const svg: FileType = { ...png, id: "svg", label: "SVG", extensions: [".svg"], language: "xml" }

const parent = "1".repeat(40)
const head = "2".repeat(40)

function side(size: number, commit?: string): DiffSide {
  return { size, binary: true, tooLarge: false, ...(commit ? { commit } : {}) }
}

function response(original: DiffSide | null, modified: DiffSide | null, status: DiffResponse["status"], documentType = png): DiffResponse {
  return { path: "img/logo.png", status, documentType, original, modified, lineDiff: null }
}

test("modes start at 2-up and name Swipe and Onion skin", () => {
  assert.deepEqual(imageDiffModes.map((mode) => mode.label), ["2-up", "Swipe", "Onion skin"])
})

test("a commit diff reads both sides at their commits", () => {
  const sides = imageSides("/repo", response(side(10, parent), side(20, head), "modified"), "7")
  assert.deepEqual(sides, {
    before: { path: "img/logo.png", size: 10, url: `/api/image?project=%2Frepo&path=img%2Flogo.png&at=${parent}` },
    after: { path: "img/logo.png", size: 20, url: `/api/image?project=%2Frepo&path=img%2Flogo.png&at=${head}` },
  })
})

test("an uncommitted diff reads the new side from the working tree at the diff's revision", () => {
  const sides = imageSides("/repo", response(side(10, head), side(20), "modified"), "7")
  assert.equal(sides?.before?.url, `/api/image?project=%2Frepo&path=img%2Flogo.png&at=${head}`)
  assert.equal(sides?.after?.url, "/api/image?project=%2Frepo&path=img%2Flogo.png&r=7")
})

test("added images show only the new side and deleted only the old", () => {
  const added = imageSides("/repo", response(null, side(20), "untracked"), "1")
  assert.equal(added?.before, null)
  assert.equal(added?.after?.size, 20)
  const deleted = imageSides("/repo", response(side(10, parent), null, "deleted"), "1")
  assert.equal(deleted?.after, null)
  assert.equal(deleted?.before?.size, 10)
})

test("a rename's old side reads the old path", () => {
  const renamed = { ...response(side(10, parent), side(10, head), "renamed"), oldPath: "img/old.png" }
  assert.equal(imageSides("/repo", renamed, "1")?.before?.path, "img/old.png")
  assert.match(imageSides("/repo", renamed, "1")?.before?.url ?? "", /path=img%2Fold\.png/)
})

test("sides fall back to the binary notice when they can't be read", () => {
  // Not a raster image: SVG keeps its text diff.
  assert.equal(imageSides("/repo", response(side(10, parent), side(20, head), "modified", svg), "1"), null)
  // Over the image limit on either side.
  assert.equal(imageSides("/repo", response(side(maxImageBytes + 1, parent), side(20, head), "modified"), "1"), null)
  assert.equal(imageSides("/repo", response(side(10, parent), side(maxImageBytes + 1), "modified"), "1"), null)
  // An old side without its commit.
  assert.equal(imageSides("/repo", response(side(10), side(20), "modified"), "1"), null)
  // Exactly at the limit still shows.
  assert.notEqual(imageSides("/repo", response(side(maxImageBytes, parent), side(maxImageBytes), "modified"), "1"), null)
})

test("imageUrl prefers the commit over a revision", () => {
  assert.equal(imageUrl("p", "a.png", head, "3"), `/api/image?project=p&path=a.png&at=${head}`)
  assert.equal(imageUrl("p", "a.png", "", ""), "/api/image?project=p&path=a.png")
})

test("imageMeta reads dimensions and size", () => {
  assert.equal(imageMeta({ width: 1920, height: 1080 }, 65_536), "1920 × 1080 · 64.0 KB")
  assert.equal(imageMeta(null, 512), "512 B")
})

test("stageLayout places both images at one scale from the top left", () => {
  assert.deepEqual(stageLayout({ width: 200, height: 100 }, { width: 100, height: 400 }), {
    width: 200, height: 400,
    before: { width: 100, height: 25 },
    after: { width: 50, height: 100 },
  })
  assert.deepEqual(stageLayout({ width: 0, height: 0 }, { width: 0, height: 0 }).width, 1)
})

test("slider positions stay within 0 to 100", () => {
  assert.equal(clampPercent(-5), 0)
  assert.equal(clampPercent(140), 100)
  assert.equal(clampPercent(Number.NaN), 0)
  assert.equal(pointerPercent(150, 100, 200), 25)
  assert.equal(pointerPercent(500, 100, 200), 100)
  assert.equal(pointerPercent(150, 100, 0), 0)
})

test("swipeClip shows the after image left of the handle", () => {
  assert.equal(swipeClip(30), "inset(0 70% 0 0)")
  assert.equal(swipeClip(0), "inset(0 100% 0 0)")
  assert.equal(swipeClip(120), "inset(0 0% 0 0)")
})
