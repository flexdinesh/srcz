import { useEffect, useState } from "react"

interface TitleBarProps {
  // title is the window title (document.title).
  title: string
}

// TitleBar is the desktop app's title band on macOS (decision 0119). It has
// no height in browsers and on other platforms; under the hidden native
// title bar it carries the theme up to the window's edge, drags the window,
// and shows its title.
export function TitleBar({ title }: TitleBarProps) {
  const focused = useWindowFocused()
  return (
    <div className="title-bar" data-window-focused={focused}>
      <span className="title-bar-title" aria-hidden="true">{title}</span>
    </div>
  )
}

// useWindowFocused follows window focus, so the title dims in background
// windows like a native title bar.
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const focus = () => setFocused(true)
    const blur = () => setFocused(false)
    window.addEventListener("focus", focus)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("focus", focus)
      window.removeEventListener("blur", blur)
    }
  }, [])
  return focused
}
