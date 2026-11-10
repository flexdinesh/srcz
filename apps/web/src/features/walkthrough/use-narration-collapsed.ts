import { useCallback, useState } from "react"

import { narrationCollapsed, readNarrationCollapsed, storeNarrationCollapsed } from "./narration-memory.ts"

// useNarrationCollapsed holds whether the narration panel is collapsed,
// remembered per browser (decision 0135).
export function useNarrationCollapsed(mobile: boolean) {
  const [stored, setStored] = useState(readNarrationCollapsed)
  const change = useCallback((collapsed: boolean) => {
    setStored(collapsed)
    storeNarrationCollapsed(collapsed)
  }, [])
  return { collapsed: narrationCollapsed(stored, mobile), change }
}
