import { cn } from "cn"

const GRIDS = {
  small: {
    viewBox: "0 0 16 16",
    z: "M2 1H14V4L8 12H14V15H2V12L8 4H2z",
    rails: "M2 5H4V8.45L2 11.12zM14 11H12V7.55L14 4.88z",
  },
  display: {
    viewBox: "0 0 32 32",
    z: "M4 2H28V8.5L14 23.5H28V30H4V23.5L18 8.5H4z",
    rails: "M4 9.5H8V18.12L4 22.4zM28 22.5H24V13.88L28 9.6z",
  },
}

export type BrandMarkProps = {
  /** `small` is drawn on the 16 grid for 24px and under, `display` on the 32 grid. */
  size?: keyof typeof GRIDS
  /** `mono` takes the surrounding text color; `brand` draws the zero's rails in coral. */
  tone?: "mono" | "brand"
  className?: string
}

// BrandMark draws the Source Zero mark, a Z inside a zero (decision 0104). It is
// decorative: the surrounding link or heading names it.
export function BrandMark({ size = "small", tone = "mono", className }: BrandMarkProps) {
  const grid = GRIDS[size]
  return (
    <svg className={cn("ui-brand-mark", className)} data-tone={tone} viewBox={grid.viewBox} aria-hidden="true">
      <path fill="currentColor" d={grid.z} />
      <path className="ui-brand-mark-rails" fill="currentColor" d={grid.rails} />
    </svg>
  )
}
