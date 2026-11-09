import { createContext, useContext, useEffect, useMemo, useState, type PointerEvent, type ReactNode } from "react"

import type { DiffResponse } from "@srcz/contracts"
import { StatusMessage } from "@/components/ui/notice"

import { SegmentedControl, SegmentedItem } from "../../components/ui/segmented-control.tsx"
import { Slider } from "../../components/ui/slider.tsx"
import {
  imageDiffModes, imageMeta, imageSides, pointerPercent, stageLayout, swipeClip,
  type Dimensions, type ImageDiffMode, type ImageSide,
} from "./image-diff.ts"

// A review tab keeps one image comparison mode for its images (decision
// 0116); it starts at 2-up.
interface ImageDiffSettings {
  project: string
  mode: ImageDiffMode
  setMode(mode: ImageDiffMode): void
}

const ImageDiffContext = createContext<ImageDiffSettings | null>(null)

export function ImageDiffProvider({ project, children }: { project: string; children: ReactNode }) {
  const [mode, setMode] = useState<ImageDiffMode>("2-up")
  const value = useMemo(() => ({ project, mode, setMode }), [mode, project])
  return <ImageDiffContext.Provider value={value}>{children}</ImageDiffContext.Provider>
}

// revisions names each diff read, so a reread loads working-tree images
// again while a cached diff reuses them.
const revisions = new WeakMap<DiffResponse, string>()
let lastRevision = 0
function revisionOf(diff: DiffResponse): string {
  let revision = revisions.get(diff)
  if (!revision) {
    lastRevision += 1
    revision = String(lastRevision)
    revisions.set(diff, revision)
  }
  return revision
}

type ImageLoad =
  | { status: "absent" }
  | { status: "loading" }
  | { status: "ready"; dimensions: Dimensions }
  | { status: "error" }

// useImage loads an image to learn its dimensions; the shown elements then
// reuse the loaded image.
function useImage(url: string): ImageLoad {
  const [loaded, setLoaded] = useState<{ url: string; load: ImageLoad } | null>(null)
  useEffect(() => {
    if (!url) return
    const image = new Image()
    image.onload = () => setLoaded({ url, load: { status: "ready", dimensions: { width: image.naturalWidth, height: image.naturalHeight } } })
    image.onerror = () => setLoaded({ url, load: { status: "error" } })
    image.src = url
    return () => {
      image.onload = null
      image.onerror = null
      image.src = ""
    }
  }, [url])
  if (!url) return { status: "absent" }
  return loaded?.url === url ? loaded.load : { status: "loading" }
}

function dimensionsOf(load: ImageLoad): Dimensions | null {
  return load.status === "ready" ? load.dimensions : null
}

interface ImageDiffProps {
  diff: DiffResponse
  // fallback is the binary notice, shown when the images can't be.
  fallback: ReactNode
}

// ImageDiff compares a raster image's sides: 2-up side by side, Swipe, or
// Onion skin. Added and deleted images show their one side.
export function ImageDiff({ diff, fallback }: ImageDiffProps) {
  const settings = useContext(ImageDiffContext)
  const project = settings?.project ?? ""
  const sides = useMemo(() => project ? imageSides(project, diff, revisionOf(diff)) : null, [diff, project])
  const before = useImage(sides?.before?.url ?? "")
  const after = useImage(sides?.after?.url ?? "")
  if (!settings || !sides || before.status === "error" || after.status === "error") return fallback
  const both = sides.before !== null && sides.after !== null
  const mode = both ? settings.mode : "2-up"
  return (
    <div className="image-diff">
      {both && (
        <SegmentedControl size="sm" className="image-diff-modes" aria-label="Image comparison">
          {imageDiffModes.map((choice) => (
            <SegmentedItem key={choice.value} pressed={mode === choice.value}
              onClick={() => settings.setMode(choice.value)}>{choice.label}</SegmentedItem>
          ))}
        </SegmentedControl>
      )}
      {mode === "2-up" && (
        <div className="image-diff-sides">
          {sides.before && <ImageFigure side={sides.before} kind="before" label={both ? "Before" : "Deleted"} dimensions={dimensionsOf(before)} />}
          {sides.after && <ImageFigure side={sides.after} kind="after" label={both ? "After" : "Added"} dimensions={dimensionsOf(after)} />}
        </div>
      )}
      {mode !== "2-up" && sides.before && sides.after && (
        <ImageStage key={mode} mode={mode} before={sides.before} after={sides.after}
          beforeDimensions={dimensionsOf(before)} afterDimensions={dimensionsOf(after)} />
      )}
    </div>
  )
}

// frameStyle shows an image at its own size, scaled down to fit, never up.
function frameStyle(dimensions: Dimensions) {
  return { width: `min(100%, ${dimensions.width}px)`, aspectRatio: `${dimensions.width} / ${dimensions.height}` }
}

interface ImageFigureProps {
  side: ImageSide
  kind: "before" | "after"
  label: string
  dimensions: Dimensions | null
}

function ImageFigure({ side, kind, label, dimensions }: ImageFigureProps) {
  return (
    <figure className="image-diff-side" data-side={kind}>
      <figcaption className="image-diff-caption">
        <span className="image-diff-label">{label}</span>
        <span className="image-diff-meta">{imageMeta(dimensions, side.size)}</span>
      </figcaption>
      {dimensions ? (
        <div className="image-diff-frame" style={frameStyle(dimensions)}>
          <img src={side.url} alt={`${label}: ${side.path}`} draggable={false} />
        </div>
      ) : (
        <div className="image-diff-frame" data-loading="" aria-busy="true" aria-label={`Loading ${side.path}`} />
      )}
    </figure>
  )
}

interface ImageStageProps {
  mode: "swipe" | "onion"
  before: ImageSide
  after: ImageSide
  beforeDimensions: Dimensions | null
  afterDimensions: Dimensions | null
}

// ImageStage lays the after image over the before one at the same scale:
// Swipe shows it left of a handle, Onion skin at an opacity.
function ImageStage({ mode, before, after, beforeDimensions, afterDimensions }: ImageStageProps) {
  const [position, setPosition] = useState(50)
  if (!beforeDimensions || !afterDimensions) return <StatusMessage className="image-diff-loading">Loading images…</StatusMessage>
  const layout = stageLayout(beforeDimensions, afterDimensions)
  const swipe = mode === "swipe"
  // Dragging across the stage moves the swipe handle; the slider is the
  // keyboard's way.
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setPosition(pointerPercent(event.clientX, box.left, box.width))
  }
  return (
    <div className="image-diff-compare">
      <div className="image-diff-stage" data-mode={mode} role="group"
        aria-label={swipe ? "Swipe between before and after" : "After over before"}
        style={frameStyle(layout)}
        onPointerDown={swipe ? (event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag(event)
        } : undefined}
        onPointerMove={swipe ? (event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event) } : undefined}>
        <div className="image-diff-layer">
          <img src={before.url} alt={`Before: ${before.path}`} draggable={false}
            style={{ width: `${layout.before.width}%`, height: `${layout.before.height}%` }} />
        </div>
        <div className="image-diff-layer"
          style={swipe ? { clipPath: swipeClip(position) } : { opacity: position / 100 }}>
          <img src={after.url} alt={`After: ${after.path}`} draggable={false}
            style={{ width: `${layout.after.width}%`, height: `${layout.after.height}%` }} />
        </div>
        {swipe && <div className="image-diff-handle" style={{ left: `${position}%` }} aria-hidden="true" />}
      </div>
      <div className="image-diff-scale">
        <span className="image-diff-label" data-side="before">Before</span>
        <Slider className="image-diff-slider" value={position} onValueChange={setPosition}
          label={swipe ? "Swipe position" : "After image opacity"}
          valueText={(value) => swipe ? `${value}% after` : `${value}% opacity`} />
        <span className="image-diff-label" data-side="after">After</span>
      </div>
    </div>
  )
}
