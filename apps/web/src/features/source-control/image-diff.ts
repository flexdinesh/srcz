import type { DiffResponse, DiffSide } from "@srcz/contracts"
import { formatBytes } from "../../lib/format-bytes.ts"

// Image diffs (decision 0116) show a raster image's sides from /api/image:
// the old side at the commit the diff read it from, the new side from that
// commit or the working tree.

export type ImageDiffMode = "2-up" | "swipe" | "onion"

export const imageDiffModes: ReadonlyArray<{ value: ImageDiffMode; label: string }> = [
  { value: "2-up", label: "2-up" },
  { value: "swipe", label: "Swipe" },
  { value: "onion", label: "Onion skin" },
]

// maxImageBytes is the server's contract.MaxImageBytes: larger images at a
// commit are refused, so neither side is shown past it.
export const maxImageBytes = 32 * 1024 * 1024

export interface ImageSide {
  path: string
  url: string
  size: number
}

// ImageSides are a diff's images: before is null for an added image, after
// for a deleted one.
export interface ImageSides {
  before: ImageSide | null
  after: ImageSide | null
}

export function imageUrl(project: string, path: string, at: string, revision: string): string {
  const params = new URLSearchParams({ project, path })
  if (at) params.set("at", at)
  // A working-tree image changes under the same path; its revision names
  // the diff read, so a reread loads it again.
  else if (revision) params.set("r", revision)
  return `/api/image?${params.toString()}`
}

function imageSide(project: string, path: string, side: DiffSide, revision: string): ImageSide {
  return { path, url: imageUrl(project, path, side.commit ?? "", revision), size: side.size }
}

// imageSides picks the images a diff can show, or null when it shows the
// binary notice instead: the file is not a raster image, a side is over the
// image limit, or the old side names no commit.
export function imageSides(project: string, diff: DiffResponse, revision: string): ImageSides | null {
  const { original, modified, documentType } = diff
  if (documentType.previewKind !== "image" || documentType.language !== "") return null
  if (!original && !modified) return null
  if ((original?.size ?? 0) > maxImageBytes || (modified?.size ?? 0) > maxImageBytes) return null
  if (original && !original.commit) return null
  return {
    before: original ? imageSide(project, diff.oldPath || diff.path, original, revision) : null,
    after: modified ? imageSide(project, diff.path, modified, revision) : null,
  }
}

export interface Dimensions {
  width: number
  height: number
}

// imageMeta reads "1920 × 1080 · 64.0 KB", or the size alone until the
// image's dimensions are known.
export function imageMeta(dimensions: Dimensions | null, size: number): string {
  return dimensions ? `${dimensions.width} × ${dimensions.height} · ${formatBytes(size)}` : formatBytes(size)
}

// StageLayout places two images on one stage at the same scale, from its
// top left: the stage is as large as the larger of each dimension, and each
// image a percentage of it.
export interface StageLayout {
  width: number
  height: number
  before: { width: number; height: number }
  after: { width: number; height: number }
}

export function stageLayout(before: Dimensions, after: Dimensions): StageLayout {
  const width = Math.max(before.width, after.width, 1)
  const height = Math.max(before.height, after.height, 1)
  const share = (image: Dimensions) => ({ width: (image.width / width) * 100, height: (image.height / height) * 100 })
  return { width, height, before: share(before), after: share(after) }
}

// clampPercent bounds a slider position to 0–100.
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

// pointerPercent is a pointer's position across a box as a percentage.
export function pointerPercent(clientX: number, left: number, width: number): number {
  return width > 0 ? clampPercent(Math.round(((clientX - left) / width) * 100)) : 0
}

// swipeClip shows the after image left of the handle at position percent.
export function swipeClip(position: number): string {
  return `inset(0 ${100 - clampPercent(position)}% 0 0)`
}
