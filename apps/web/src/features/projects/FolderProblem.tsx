import { ArrowUpRightIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "../../components/ui/button.tsx"
import { isAbort } from "../../api/http.ts"
import { removeRoot } from "../../api/projects-data.ts"
import { desktopBridge } from "../../lib/desktop-bridge.ts"
import { privacySettingsUrl, servedRootOf } from "./folder-problem.ts"
import { useManageRoots } from "./use-manage-roots.ts"

interface FolderProblemProps {
  project: string
  // roots are the served roots the page reported.
  roots: readonly string[]
  message: string
  code: string
  onChooseProject(): void
  // onStopped lands elsewhere once the project's root stopped being served.
  onStopped(): void
}

// FolderProblem explains a project folder zero cannot read (decision 0146):
// the server's reason, then Stop serving its root where the server manages
// roots, Choose another project, and, in a local desktop window on macOS,
// the privacy settings that grant access.
export function FolderProblem({ code, message, onChooseProject, onStopped, project, roots }: FolderProblemProps) {
  const manageRoots = useManageRoots()
  const [stop, setStop] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string }>({ kind: "idle" })
  const root = servedRootOf(project, roots)
  // Remote windows have no revealPath: their files are on another computer.
  const local = desktopBridge()?.revealPath != null
  const privacy = code === "privacyBlocked" && local

  function stopServing() {
    if (!root) return
    setStop({ kind: "busy" })
    removeRoot(root).then(
      () => onStopped(),
      (error: unknown) => {
        if (isAbort(error)) return
        setStop({ kind: "error", message: error instanceof Error ? error.message : "Couldn't stop serving the folder." })
      },
    )
  }

  return (
    <div className="error folder-problem" role="alert">
      <p>{message}</p>
      <div className="folder-problem-actions">
        {manageRoots && root && (
          <Button type="button" variant="outline" disabled={stop.kind === "busy"} onClick={stopServing}>
            Stop serving {baseName(root)}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onChooseProject}>Choose another project</Button>
        {privacy && (
          <a className="folder-problem-link" href={privacySettingsUrl}>
            Open Privacy Settings<ArrowUpRightIcon aria-hidden="true" />
          </a>
        )}
      </div>
      {stop.kind === "error" && <p className="folder-problem-failure">{stop.message}</p>}
    </div>
  )
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path
}
