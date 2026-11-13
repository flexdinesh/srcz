import { Popover } from "@base-ui/react/popover"
import { cn } from "cn"
import { useId, type ReactNode, type Ref, type RefObject } from "react"

// A pointer resting on the trigger opens the card after hoverCardDelay; it
// closes hoverCardCloseDelay after the pointer leaves both, so the pointer can
// cross the gap into the card.
export const hoverCardDelay = 400
export const hoverCardCloseDelay = 150

interface HoverCardProps {
  // trigger is the trigger's content; triggerLabel is its accessible name.
  trigger: ReactNode
  triggerLabel: string
  triggerClassName?: string
  triggerRef?: Ref<HTMLButtonElement>
  // tabbable false keeps the trigger out of the Tab order, for triggers inside
  // a composite that is one Tab stop, such as Source.
  tabbable?: boolean
  // label names the card.
  label: string
  // open and onOpenChange control the card; without open it controls itself.
  open?: boolean
  onOpenChange?(open: boolean): void
  // initialFocus is the control a press or open focuses, else the first.
  initialFocus?: RefObject<HTMLElement | null>
  side?: "top" | "bottom"
  className?: string
  children: ReactNode
}

// HoverCard shows details about its trigger on the overlay surface. A
// precise pointer opens it by resting on the trigger; a click or tap toggles
// it (phones). Opened by hover, it leaves focus where it is; opened by a
// press or by open, it moves focus to initialFocus or its first control.
// Escape closes it and returns focus to the trigger.
export function HoverCard({
  trigger, triggerLabel, triggerClassName, triggerRef, tabbable = true, label, open, onOpenChange, initialFocus, side = "bottom", className, children,
}: HoverCardProps) {
  const id = useId()
  return (
    <Popover.Root open={open} triggerId={open === undefined ? undefined : id}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <Popover.Trigger id={id} ref={triggerRef} openOnHover delay={hoverCardDelay} closeDelay={hoverCardCloseDelay}
        className={cn("ui-hover-card-trigger", triggerClassName)} aria-label={triggerLabel} tabIndex={tabbable ? undefined : -1}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="ui-hover-card-positioner" side={side} align="start" sideOffset={4} collisionPadding={8}>
          <Popover.Popup className={cn("ui-popover ui-hover-card", className)} aria-label={label} initialFocus={initialFocus}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
