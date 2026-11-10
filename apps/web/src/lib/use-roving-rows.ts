import { useRef, useState, type KeyboardEvent } from "react"

// useRovingRows moves focus through a listbox's options with the arrow keys,
// Home, and End; Enter activates the focused one.
export function useRovingRows(count: number, current: number, activate: (index: number) => void) {
  const container = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(-1)
  const tabIndex = focused >= 0 && focused < count ? focused : Math.max(0, current)
  function focusRow(index: number) {
    setFocused(index)
    container.current?.querySelectorAll<HTMLElement>("[role=option]")[index]?.focus()
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = tabIndex + (event.key === "ArrowDown" ? 1 : -1)
      if (next >= 0 && next < count) focusRow(next)
    } else if (event.key === "Home" || event.key === "End") {
      focusRow(event.key === "Home" ? 0 : count - 1)
    } else if (event.key === "Enter" || event.key === " ") {
      activate(tabIndex)
    } else {
      return
    }
    event.preventDefault()
  }
  return { container, tabIndex, setFocused, onKeyDown }
}
