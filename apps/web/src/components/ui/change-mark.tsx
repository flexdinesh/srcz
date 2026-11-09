import type { MouseEvent, PointerEvent } from "react"
import { cn } from "cn"

export type ChangeMarkKind = "added" | "modified" | "deleted"
// A deletion's wedge sits on its row's top edge, shared with the row above
// (between), inside the first row's top (start), or inside the last row's
// bottom (end).
export type ChangeMarkEdge = "between" | "start" | "end"

interface ChangeMarkProps {
  kind: ChangeMarkKind
  // label names the change in words ("Added lines 3–5"): the tooltip and,
  // when named, the accessible name.
  label: string
  // named is false for a range's later rows, which repeat its first.
  named?: boolean
  edge?: ChangeMarkEdge
  className?: string
  onActivate(): void
}

function stop(event: PointerEvent | MouseEvent) {
  event.stopPropagation()
}

// ChangeMark is a line gutter's change marker: a thin bar per row (success
// for added, accent for modified) or a destructive wedge between rows for
// deleted lines. It fills its gutter's end inset, which must be positioned.
// Its presses stay out of the gutter, which selects lines. It is no Tab
// stop: a document's changes are reached by keyboard through its review.
export function ChangeMark({ kind, label, named = true, edge = "between", className, onActivate }: ChangeMarkProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={cn("ui-change-mark", className)}
      data-kind={kind}
      data-edge={kind === "deleted" ? edge : undefined}
      title={label}
      aria-label={named ? label : undefined}
      aria-hidden={named ? undefined : true}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={(event) => {
        event.stopPropagation()
        onActivate()
      }}
    />
  )
}
