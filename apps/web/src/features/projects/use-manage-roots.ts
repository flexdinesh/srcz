import { useEffect, useState } from "react"

import { fetchProjects } from "../../api/projects-data.ts"

// useManageRoots reports whether the server opens folders on its host and
// stops serving roots (decision 0146); false until known or when projects
// cannot be listed.
export function useManageRoots(): boolean {
  const [manageRoots, setManageRoots] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    fetchProjects(abort.signal).then((value) => setManageRoots(value.manageRoots), () => undefined)
    return () => abort.abort()
  }, [])
  return manageRoots
}
