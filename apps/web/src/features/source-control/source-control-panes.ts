import type { StackLayer, StackResponse } from "@zero/contracts"
import { branchCompare, type Compare } from "./compare.ts"
import { displayOrder, type CompareFile } from "./compare-files.ts"

// Pure decisions behind Source Control's panes (decisions 0040, 0112): when
// the branch range applies, what each commit and stack row diffs, and how the
// flat change list names files.

// onBaseBranch is whether HEAD is the base branch itself, or a local branch
// tracking origin's copy of it; commits then list all history.
export function onBaseBranch(branch: string, base: string): boolean {
  return branch !== "" && base !== "" && (base === branch || base === `origin/${branch}`)
}

// DiffGlyph is the diff a commit row's glyph stands for (Enter opens it), and
// whether the glyph stays shown (on the selection) rather than only on hover
// or focus.
export interface DiffGlyph {
  compare: Compare
  pinned: boolean
}

// diffGlyph places the diff glyph on a commit row: a range's newest commit
// stands for the range, its other commits show none, and any other commit
// stands for itself, pinned when it is the selection. selected lists the
// selection's hashes.
export function diffGlyph(hash: string, selection: Compare | null, selected: readonly string[]): DiffGlyph | null {
  if (selection?.kind === "range" && selected.includes(hash)) {
    return hash === selection.to ? { compare: selection, pinned: true } : null
  }
  return { compare: { kind: "commit", hash }, pinned: selection?.kind === "commit" && selection.hash === hash }
}

// detailsFileLimit is how many files a commit's details list.
export const detailsFileLimit = 20

// DetailsFiles is what a commit's details list: the first files in review
// order, and how many more the review holds (more is set when the server
// truncated the list).
export interface DetailsFiles {
  shown: CompareFile[]
  more: number
  truncated: boolean
}

// detailsFiles caps a commit's files for its details, in the order the
// review shows them.
export function detailsFiles(files: readonly CompareFile[], truncated: boolean, limit = detailsFileLimit): DetailsFiles {
  const ordered = displayOrder(files)
  return { shown: ordered.slice(0, limit), more: Math.max(0, ordered.length - limit), truncated }
}

// moreFilesLabel names the row after a capped list: "3 more files",
// "1 more file", or "20+ more files" when the server truncated it.
export function moreFilesLabel(list: DetailsFiles): string {
  if (list.more === 0 && !list.truncated) return ""
  if (list.more === 0) return "More files"
  return `${list.more.toLocaleString()}${list.truncated ? "+" : ""} more ${list.more === 1 && !list.truncated ? "file" : "files"}`
}

// RefChip names a local branch at a commit, in its layer's lane.
export interface RefChip {
  name: string
  current: boolean
  lane: number
}

// laneHues is how many lanes the layers other than HEAD's cycle through;
// HEAD's layer is lane 0 (decision 0129).
export const laneHues = 3

// layerLanes gives each stack layer, top to bottom, its lane: 0 for HEAD's,
// then 1 to laneHues for the others in turn.
export function layerLanes(layers: readonly StackLayer[]): number[] {
  let other = 0
  return layers.map((layer) => layer.current ? 0 : (other++ % laneHues) + 1)
}

// commitLanes maps the listed commits to their stack layer's lane: a layer's
// tip and its ahead commits after it in list order, up to the merge-base. A
// filtered list skips commits, so it shows no lanes.
export function commitLanes(commits: readonly { hash: string }[], stack: StackResponse | null, filtered: boolean): ReadonlyMap<string, number> {
  const lanes = new Map<string, number>()
  if (!stack || filtered) return lanes
  const order = layerLanes(stack.layers)
  const tips = new Map(stack.layers.map((layer, index) => [layer.head, { lane: order[index] ?? 0, ahead: layer.ahead }]))
  let lane = 0
  let remaining = 0
  for (const commit of commits) {
    if (commit.hash === stack.mergeBase) break
    const tip = tips.get(commit.hash)
    if (tip) {
      lane = tip.lane
      remaining = tip.ahead
    }
    if (remaining <= 0) continue
    lanes.set(commit.hash, lane)
    remaining--
  }
  return lanes
}

// refChips maps each stack layer's commit to its branch names, current
// first.
export function refChips(stack: StackResponse | null): ReadonlyMap<string, readonly RefChip[]> {
  const chips = new Map<string, RefChip[]>()
  const layers = stack?.layers ?? []
  const lanes = layerLanes(layers)
  layers.forEach((layer, index) => {
    const names = [layer.name, ...layer.aliases].filter(Boolean)
    if (names.length === 0) return
    chips.set(layer.head, names.map((name) => ({ name, current: layer.current && name === layer.name, lane: lanes[index] ?? 0 })))
  })
  return chips
}

// StackRow is one Branches row with what its actions diff: the layer's own
// commits against the layer below (null for the lowest, where it equals the
// base diff), and everything since the base.
export interface StackRow {
  layer: StackLayer
  layerDiff: Compare | null
  baseDiff: Compare
  // lane is the layer's hue (layerLanes).
  lane: number
}

// stackRows lists the stack top to bottom. base is the chosen base ("" for
// the default), kept in compares so they match the branch review. HEAD's
// layer compares as HEAD, so its review stays live with the checkout.
export function stackRows(stack: StackResponse | null, base: string): StackRow[] {
  if (!stack) return []
  const lanes = layerLanes(stack.layers)
  return stack.layers.map((layer, index) => {
    const head = layer.current ? "" : layer.name
    const below = stack.layers.find((other) => other.name !== "" && other.name === layer.parent)
    return {
      layer,
      layerDiff: below ? branchCompare(below.name, head) : null,
      baseDiff: branchCompare(base, head),
      lane: lanes[index] ?? 0,
    }
  })
}

// fileParts splits a path into the flat list's name and muted folder.
export function fileParts(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf("/")
  return slash < 0 ? { name: path, folder: "" } : { name: path.slice(slash + 1), folder: path.slice(0, slash) }
}
