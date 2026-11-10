import { MapPinIcon } from "lucide-react"
import { useEffect } from "react"

import type { StepCheck } from "./walkthrough-steps.ts"

const mac = typeof navigator !== "undefined" && navigator.platform.includes("Mac")
export const nextStepKeys = mac ? "⌘→" : "Ctrl+Right"
export const previousStepKeys = mac ? "⌘←" : "Ctrl+Left"

interface StepMarkerProps {
  index: number
  // check is the step's drift, read from the code the marker sits in.
  check: StepCheck
  // lines is whether the marker sits under the step's lines; a step without
  // them only reports its check.
  lines: boolean
  onCheck(check: StepCheck): void
}

// StepMarker sits in the code under a step's lines (decision 0135): the
// step's narration is in the panel above the document, so the code keeps
// only a slim line naming the step. It reports the step's drift, which only
// the code it sits in can read, to the panel.
export function StepMarker({ check, index, lines, onCheck }: StepMarkerProps) {
  const { drift, expected, actual } = check
  useEffect(() => {
    onCheck({ drift, expected, actual })
  }, [actual, drift, expected, onCheck])
  if (!lines) return null
  return (
    <span className="step-marker">
      <MapPinIcon className="step-marker-icon" aria-hidden="true" />
      Step {(index + 1).toLocaleString()}
    </span>
  )
}
