import { cn } from "cn"
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react"

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed" | "aria-label" | "onClick">

export interface ToggleButtonProps extends NativeProps {
  pressed: boolean
  onPressedChange(pressed: boolean): void
  children: ReactNode
  // label names icon-only toggles; text toggles name themselves.
  label?: string
  // icon toggles are 20px squares in fields; text toggles are 28px tall.
  size?: "icon" | "text"
  ref?: Ref<HTMLButtonElement>
}

// ToggleButton is an independent on/off option: accent border, ink, and tint
// while pressed.
export function ToggleButton({
  pressed, onPressedChange, children, label, size = "icon", className, type = "button", title, ref, ...props
}: ToggleButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("ui-toggle", className)}
      data-size={size}
      aria-pressed={pressed}
      aria-label={label}
      title={title ?? label}
      onClick={() => onPressedChange(!pressed)}
      {...props}
    >
      {children}
    </button>
  )
}

export interface ToggleGlyphProps {
  children: string
  underline?: boolean
}

// ToggleGlyph is a toggle's face set as type rather than drawn: letters such
// as Aa, ab, and .* in the UI face, so they keep real letterforms at 12px.
// The toggle's label names it; the glyph is hidden from assistive technology.
export function ToggleGlyph({ children, underline = false }: ToggleGlyphProps) {
  return <span className="ui-toggle-glyph" data-underline={underline || undefined} aria-hidden="true">{children}</span>
}
