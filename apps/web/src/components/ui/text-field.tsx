import { cn } from "cn"
import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from "react"

export type FieldVariant = "field" | "palette"

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  // className styles the wrapper; the remaining props go to the input.
  className?: string
  inputClassName?: string
  inputRef?: Ref<HTMLInputElement>
  variant?: FieldVariant
  icon?: ReactNode
  // leading holds interactive content before the input, such as a back button.
  leading?: ReactNode
  // trailing holds counts, toggles, and clear buttons inside the field.
  trailing?: ReactNode
  invalid?: boolean
}

// TextField is a single-line input. field: 28px bordered, for filters and
// forms. palette: borderless 40px (44px narrow) with an accent underline,
// 14px text, and a 16px icon, for dialogs.
export function TextField({
  className, inputClassName, inputRef, variant = "field", icon, leading, trailing, invalid, ...props
}: TextFieldProps) {
  return (
    <div className={cn("ui-field", className)} data-variant={variant} data-invalid={invalid || undefined}>
      {icon && <span className="ui-field-icon" aria-hidden="true">{icon}</span>}
      {leading}
      <input ref={inputRef} className={cn("ui-field-input", inputClassName)} aria-invalid={invalid || undefined} {...props} />
      {trailing && <span className="ui-field-trailing">{trailing}</span>}
    </div>
  )
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

// TextArea is a multi-line field in the field treatment: it grows with its
// text from its rows up to a cap, then scrolls.
export function TextArea({ className, invalid, ref, ...props }: TextAreaProps) {
  return <textarea ref={ref} className={cn("ui-textarea", className)} aria-invalid={invalid || undefined} {...props} />
}
