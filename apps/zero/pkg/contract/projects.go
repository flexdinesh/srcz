package contract

// ProjectKind tells a linked worktree from a repository or folder.
type ProjectKind string

const (
	ProjectFolder   ProjectKind = "folder"
	ProjectRepo     ProjectKind = "repo"
	ProjectWorktree ProjectKind = "worktree"
)

// Root is a served root directory. Problem explains why zero cannot read
// it, with ProblemCode (CodePrivacyBlocked or CodeFolderUnreadable); both
// are empty for a readable root (decision 0146).
type Root struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	IsRepo      bool   `json:"isRepo"`
	Problem     string `json:"problem,omitempty"`
	ProblemCode string `json:"problemCode,omitempty"`
}

// Project is a project within the served roots. ID is the absolute path, or
// empty for a project that cannot be opened. Members of one repository share
// Group, the path of its main worktree; Root is the served root it, or its
// repository, lives in. Repository names its repository: the origin remote's
// name, else the main worktree's folder; empty for a folder.
//
//contract:rule available == true => id != ""
//contract:rule available == false => id == ""
type Project struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Path       string      `json:"path"`
	Kind       ProjectKind `json:"kind"`
	Group      string      `json:"group"`
	Root       string      `json:"root"`
	Branch     string      `json:"branch"`
	Repository string      `json:"repository"`
	Available  bool        `json:"available"`
}

// ProjectsResponse is GET /api/projects.
type ProjectsResponse struct {
	// SessionKey keys the last project remembered for this session: "daemon"
	// under the daemon, else the served roots joined by newlines.
	SessionKey string `json:"sessionKey"`
	// Presence asks a page to hold /api/presence while open: this server's
	// lifetime follows its UIs (decision 0098).
	Presence bool `json:"presence"`
	// ManageRoots reports that this server opens folders anywhere on its
	// host and stops serving roots (POST and DELETE /api/roots); the daemon
	// does, a CLI-served session does not (decision 0146).
	ManageRoots bool      `json:"manageRoots"`
	Roots       []Root    `json:"roots"`
	Projects    []Project `json:"projects"`
	Warnings    []string  `json:"warnings"`
}

// Directory is a child directory of a browsed folder: within the served
// roots, or anywhere on the host when the server manages roots. Problem
// explains why zero cannot read it, with ProblemCode; both are empty for a
// readable folder (decision 0146).
type Directory struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsProject   bool   `json:"isProject"`
	Problem     string `json:"problem,omitempty"`
	ProblemCode string `json:"problemCode,omitempty"`
}

// DirectoriesResponse is GET /api/directories. Path is the folder listed:
// the host's home folder for an empty path when the server manages roots.
type DirectoriesResponse struct {
	Path        string      `json:"path"`
	Directories []Directory `json:"directories"`
}

// OpenedRoot is POST /api/roots's answer (and POST /_daemon/open's): the
// root serving the path, whether it was added, the roots it replaced (inside
// it), and the project that shows the path (decision 0146).
type OpenedRoot struct {
	Root     string   `json:"root"`
	Added    bool     `json:"added"`
	Replaced []string `json:"replaced"`
	Project  string   `json:"project"`
}

// RemovedRoot is DELETE /api/roots's answer: the root no longer served and
// the roots still served (decision 0146).
type RemovedRoot struct {
	Root  string   `json:"root"`
	Roots []string `json:"roots"`
}
