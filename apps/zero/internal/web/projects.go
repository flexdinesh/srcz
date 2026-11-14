package web

import (
	"encoding/json"
	"mime"
	"net/http"

	"github.com/flexdinesh/zero/pkg/contract"
)

func (a *App) serveProjects(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, a.app.Projects.List())
}

func (a *App) serveDirectories(w http.ResponseWriter, path string) {
	directories, err := a.app.Projects.Directories(path)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, directories)
}

// serveOpenRoot answers POST /api/roots {path}: 201 when the folder became a
// root, else 200 (decision 0146). Writes come from zero's own page or from
// outside a browser, in JSON.
func (a *App) serveOpenRoot(w http.ResponseWriter, r *http.Request) {
	if writeRootGuards(w, r) {
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRootRequest))
	decoder.DisallowUnknownFields()
	var request contract.RootRequest
	if err := decoder.Decode(&request); err != nil || request.Path == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: `Send {"path": "/absolute/folder"}.`, Code: contract.CodeInvalidRequest})
		return
	}
	opened, err := a.app.Projects.OpenRoot(request.Path)
	if err != nil {
		writeError(w, err)
		return
	}
	status := http.StatusOK
	if opened.Added {
		status = http.StatusCreated
	}
	writeJSON(w, status, opened)
}

// serveRemoveRoot answers DELETE /api/roots?path=: zero stops serving the
// root (decision 0146).
func (a *App) serveRemoveRoot(w http.ResponseWriter, r *http.Request) {
	if writeRootGuards(w, r) {
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "Name the root to stop serving with path.", Code: contract.CodeInvalidRequest})
		return
	}
	removed, err := a.app.Projects.RemoveRoot(path)
	writeResult(w, removed, err)
}

// maxRootRequest bounds a POST /api/roots body.
const maxRootRequest = 1 << 20

// writeRootGuards refuses a root write from another site or, for POST, not
// in JSON; it reports whether it did.
func writeRootGuards(w http.ResponseWriter, r *http.Request) bool {
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "Served folders can't be changed from another site.", Code: contract.CodeForeignOrigin})
		return true
	}
	if r.Method != http.MethodPost {
		return false
	}
	if mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, errorResponse{Error: "Send the folder as Content-Type: application/json.", Code: contract.CodeUnsupportedMediaType})
		return true
	}
	return false
}
