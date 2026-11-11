import { useEffect, useLayoutEffect, useRef } from "react"

import { desktopBridge } from "../lib/desktop-bridge.ts"
import { historyKey, mouseDirection } from "./history-controls.ts"
import type { NavigationHistoryStore } from "./navigation-history-store.ts"

const mac = typeof navigator !== "undefined" && navigator.platform.includes("Mac")

// useNavigationKeys moves through history from the keyboard, a mouse's
// side buttons, and the desktop app's Go menu (decision 0131). A browser
// moves with its own keys and buttons; the page adds VS Code's. An open
// dialog keeps its keys.
export function useNavigationKeys(store: NavigationHistoryStore, openRecent: () => void) {
  const recent = useRef(openRecent)
  useLayoutEffect(() => { recent.current = openRecent })

  useEffect(() => {
    const desktop = desktopBridge() !== null
    const blocked = () => document.querySelector("dialog[open]") !== null
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      const direction = historyKey(event, mac, desktop)
      if (direction === null || blocked()) return
      event.preventDefault()
      store.go(direction)
    }
    function onMouse(event: MouseEvent) {
      const direction = mouseDirection(event.button)
      if (direction === null || blocked()) return
      event.preventDefault()
      store.go(direction)
    }
    // The desktop Go menu names its item; it owns the VS Code keys there.
    function onMenu(event: Event) {
      if (!(event instanceof CustomEvent)) return
      event.preventDefault()
      if (event.detail === "back") store.go(-1)
      else if (event.detail === "forward") store.go(1)
      else if (event.detail === "recent") recent.current()
    }
    document.addEventListener("keydown", onKey)
    window.addEventListener("zero:navigate", onMenu)
    if (desktop) document.addEventListener("mouseup", onMouse)
    return () => {
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("zero:navigate", onMenu)
      document.removeEventListener("mouseup", onMouse)
    }
  }, [store])
}
