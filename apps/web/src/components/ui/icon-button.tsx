import { cn } from "cn"
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react"

export type IconButtonSize = "xs" | "sm" | "md" | "bar"
export type IconButtonTone = "default" | "success" | "destructive"
// gutter floats over code in a line gutter, as CopyButton's gutter variant.
// bare takes no hover or press fill, for toggles inside a row that has its own.
export type IconButtonVariant = "plain" | "gutter" | "bare"

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "title">

export interface IconButtonProps extends NativeProps {
  // label names the action for assistive technology and the tooltip.
  label: string
  icon: ReactNode
  // title overrides the tooltip, e.g. to add a shortcut.
  title?: string
  size?: IconButtonSize
  tone?: IconButtonTone
  variant?: IconButtonVariant
  // disabledReason keeps the control focusable but inert, and explains why.
  disabledReason?: string
  ref?: Ref<HTMLButtonElement>
}

// IconButton is an icon-only action. Sizes: xs 20px (12px glyph) in rows and
// tabs, sm 24px (16px glyph) in headers, toolbars, and fields, md 28px (16px
// glyph) in panels, and bar, a square that fills its band (--bar-size). The
// gutter variant is raised and bordered, for line gutters; the bare variant
// marks hover with ink only, so it adds no fill over a hovered row.
export function IconButton({
  label, icon, title, size = "sm", tone = "default", variant = "plain", disabledReason, className, type = "button", onClick, ref, ...props
}: IconButtonProps) {
  const inert = Boolean(disabledReason)
  return (
    <button
      ref={ref}
      type={type}
      className={cn("ui-icon-button", className)}
      data-size={size}
      data-tone={tone === "default" ? undefined : tone}
      data-variant={variant === "plain" ? undefined : variant}
      aria-label={label}
      aria-disabled={inert || undefined}
      title={disabledReason || title || label}
      onClick={(event: MouseEvent<HTMLButtonElement>) => { if (!inert) onClick?.(event) }}
      {...props}
    >
      {icon}
    </button>
  )
}
