import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

interface SliderProps {
  value: number
  onValueChange(value: number): void
  // label names the slider; valueText reads its value aloud.
  label: string
  valueText?(value: number): string
  min?: number
  max?: number
  step?: number
  className?: string
}

// Slider picks one value on a 2px track with a square thumb. Arrows step,
// Page Up/Down step by ten, Home/End jump to the ends.
export function Slider({ value, onValueChange, label, valueText, min = 0, max = 100, step = 1, className }: SliderProps) {
  return (
    <SliderPrimitive.Root className={cn("ui-slider", className)} value={value} min={min} max={max} step={step}
      onValueChange={onValueChange}>
      <SliderPrimitive.Control className="ui-slider-control">
        <SliderPrimitive.Track className="ui-slider-track">
          <SliderPrimitive.Indicator className="ui-slider-indicator" />
          <SliderPrimitive.Thumb className="ui-slider-thumb" getAriaLabel={() => label}
            getAriaValueText={valueText ? (_text, current) => valueText(current) : undefined} />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
