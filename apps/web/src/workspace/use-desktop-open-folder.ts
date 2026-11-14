import { useEffect } from "react"

// The desktop app's File › Open Folder… asks the page to open its folder
// browser (decision 0146); the page owns opening folders, for local and
// remote windows alike.
export function useDesktopOpenFolder(open: () => void) {
  useEffect(() => {
    function onMenu(event: Event) {
      event.preventDefault()
      open()
    }
    window.addEventListener("zero:open-folder", onMenu)
    return () => window.removeEventListener("zero:open-folder", onMenu)
  }, [open])
}
