package app

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/flexdinesh/zero/internal/files"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/pkg/contract"
)

// Project resolution messages.
const (
	NoProjectMessage          = "No project was selected."
	ProjectUnavailableMessage = "Project unavailable."
	InsideRepositoryMessage   = "Project unavailable: folders inside a repository open with the repository."
)

// Projects lists the served projects and browses folders within the roots.
type Projects struct{ *state }

// Workspace is the project directory an operation is scoped to: its ID and
// absolute root.
type Workspace struct {
	ID   string
	Root string
}

// Resolve resolves a project ID within a snapshot of the served roots.
func (p *Projects) Resolve(id string) (Workspace, error) {
	return ResolveProject(p.config.Roots.List(), id)
}

// ResolveProject resolves a project ID within roots: an empty ID or one
// outside the roots is invalid; a folder inside a repository or a missing
// project is not found.
func ResolveProject(roots []string, id string) (Workspace, error) {
	if id == "" {
		return Workspace{}, fail(contract.KindInvalid, NoProjectMessage)
	}
	root, err := projects.Resolve(roots, id)
	if errors.Is(err, files.ErrPathEscape) {
		return Workspace{}, fail(contract.KindInvalid, ProjectUnavailableMessage)
	}
	if errors.Is(err, projects.ErrInsideRepository) {
		return Workspace{}, fail(contract.KindNotFound, InsideRepositoryMessage)
	}
	if err != nil {
		return Workspace{}, fail(contract.KindNotFound, ProjectUnavailableMessage)
	}
	return Workspace{ID: id, Root: root}, nil
}

// List discovers the projects within the served roots. A root removed while
// serving is a warning, not a failure for every root.
func (p *Projects) List() contract.ProjectsResponse {
	roots := p.config.Roots.List()
	discovery := projects.Discover(roots, p.config.ScanDepth)
	return contract.ProjectsResponse{
		SessionKey:  p.sessionKey(roots),
		Presence:    p.config.Presence,
		ManageRoots: p.config.RootControl != nil,
		Roots:       mapSlice(projects.Roots(roots), rootContract),
		Projects:    mapSlice(discovery.Projects, projectContract),
		Warnings:    warningStrings(append(discovery.Skipped, discovery.Warnings...)),
	}
}

// Directories lists a folder's child directories: anywhere on the host,
// from its home folder, when the server manages roots; else within the
// served roots.
func (p *Projects) Directories(path string) (contract.DirectoriesResponse, error) {
	if p.config.RootControl != nil {
		return hostDirectories(path)
	}
	directories, err := projects.Directories(p.config.Roots.List(), path)
	switch {
	case errors.Is(err, files.ErrPathEscape):
		return contract.DirectoriesResponse{}, fail(contract.KindInvalid, "Outside the folders zero serves.")
	case errors.Is(err, projects.ErrInsideRepository):
		return contract.DirectoriesResponse{}, fail(contract.KindInvalid, "Repositories open whole; open it to browse its files.")
	case errors.Is(err, projects.ErrUnavailable):
		return contract.DirectoriesResponse{}, fail(contract.KindNotFound, "That folder is unavailable.")
	case err != nil:
		return contract.DirectoriesResponse{}, FolderError(path, err)
	}
	return contract.DirectoriesResponse{Path: path, Directories: mapSlice(directories, directoryContract)}, nil
}

// hostDirectories lists path's child directories anywhere on the host
// (decision 0146); an empty path lists the home folder.
func hostDirectories(path string) (contract.DirectoriesResponse, error) {
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return contract.DirectoriesResponse{}, fail(contract.KindUnavailable, "zero can't find the home folder.")
		}
		path = home
	}
	if !filepath.IsAbs(path) {
		return contract.DirectoriesResponse{}, fail(contract.KindInvalid, "Type an absolute folder path.")
	}
	path = filepath.Clean(path)
	if repository, ok := projects.Repository(path); ok && repository != path {
		return contract.DirectoriesResponse{}, fail(contract.KindInvalid, "Repositories open whole. Open "+repository+" instead.")
	}
	if err := CheckFolder(path); err != nil {
		return contract.DirectoriesResponse{}, err
	}
	directories, err := projects.HostDirectories(path)
	switch {
	case errors.Is(err, projects.ErrInsideRepository):
		return contract.DirectoriesResponse{}, fail(contract.KindInvalid, "Repositories open whole; open it to browse its files.")
	case errors.Is(err, os.ErrNotExist), errors.Is(err, projects.ErrUnavailable):
		return contract.DirectoriesResponse{}, fail(contract.KindNotFound, "That folder doesn't exist.")
	case err != nil:
		return contract.DirectoriesResponse{}, FolderError(path, err)
	}
	listed := make([]contract.Directory, len(directories))
	for i, directory := range directories {
		listed[i] = directoryContract(directory)
		listed[i].Problem, listed[i].ProblemCode = rootProblem(directory.Path)
	}
	return contract.DirectoriesResponse{Path: path, Directories: listed}, nil
}

// OpenRoot serves path through RootControl (decision 0146).
func (p *Projects) OpenRoot(path string) (contract.OpenedRoot, error) {
	if p.config.RootControl == nil {
		return contract.OpenedRoot{}, unmanaged()
	}
	return p.config.RootControl.Open(path)
}

// RemoveRoot stops serving root through RootControl (decision 0146).
func (p *Projects) RemoveRoot(root string) (contract.RemovedRoot, error) {
	if p.config.RootControl == nil {
		return contract.RemovedRoot{}, unmanaged()
	}
	roots, err := p.config.RootControl.Remove(root)
	if err != nil {
		return contract.RemovedRoot{}, err
	}
	return contract.RemovedRoot{Root: root, Roots: roots}, nil
}

func unmanaged() *Error {
	return &Error{Kind: contract.KindUnavailable, Code: contract.CodeRootsUnmanaged, Message: "This zero serves a fixed set of folders; restart it with the folders to serve."}
}

func rootContract(root projects.Root) contract.Root {
	problem, code := rootProblem(root.Path)
	return contract.Root{Path: root.Path, Name: root.Name, IsRepo: root.IsRepo, Problem: problem, ProblemCode: code}
}

func projectContract(project projects.Project) contract.Project {
	return contract.Project{
		ID:         project.ID,
		Name:       project.Name,
		Path:       project.Path,
		Kind:       contract.ProjectKind(project.Kind),
		Group:      project.Group,
		Root:       project.Root,
		Branch:     project.Branch,
		Repository: project.Repository,
		Available:  project.Available,
	}
}

func directoryContract(directory projects.Directory) contract.Directory {
	return contract.Directory{Name: directory.Name, Path: directory.Path, IsProject: directory.IsProject}
}
