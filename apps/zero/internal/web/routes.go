package web

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/flexdinesh/zero/pkg/contract"
)

// contentSecurityPolicy lets pages load only zero's own scripts, styles,
// fonts, and workers.
const contentSecurityPolicy = "default-src 'none'; img-src 'self' data: blob: http: https:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"

// ServeHTTP serves under the zero HostPolicy: localhost and IP literals.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.serve(HostPolicy{}, w, r)
}

// Handler serves under policy, for a listener that is reached by name, such
// as through a Tailscale proxy (decision 0126).
func (a *App) Handler(policy HostPolicy) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { a.serve(policy, w, r) })
}

// serve refuses requests for hosts policy does not allow, then routes. Every
// request rescans the project it names.
func (a *App) serve(policy HostPolicy, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !policy.Allows(r.Host) {
		http.Error(w, "forbidden host", http.StatusForbidden)
		return
	}
	a.routes.ServeHTTP(w, r)
}

// HostPolicy is which Host headers a listener answers. A site that rebinds
// its own hostname to this address is refused, so other origins cannot read
// served files. localhost and IP literals name this machine directly and are
// always allowed; a name is allowed only when listed.
type HostPolicy struct {
	// AllowedHosts are further names, without a port, matched without case.
	// List only names whose requests a trusted proxy delivers.
	AllowedHosts []string
}

// Allows reports whether policy answers host, a Host header with an optional
// port.
func (p HostPolicy) Allows(host string) bool {
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	if strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil {
		return true
	}
	host = strings.TrimSuffix(host, ".")
	for _, allowed := range p.AllowedHosts {
		if allowed = strings.TrimSuffix(allowed, "."); allowed != "" && strings.EqualFold(host, allowed) {
			return true
		}
	}
	return false
}

// Guard refuses requests for hosts policy does not allow before next, for
// what a listener answers outside the web app.
func (p HostPolicy) Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.Allows(r.Host) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// apiHandler serves one JSON endpoint from its query.
type apiHandler func(w http.ResponseWriter, r *http.Request, query url.Values)

// newRoutes lists every endpoint. All are GET but publishing and deleting
// walkthroughs and writing feedback; JSON endpoints are never cached.
func (a *App) newRoutes() *http.ServeMux {
	mux := http.NewServeMux()
	api := func(path string, handler apiHandler) {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			handler(w, r, r.URL.Query())
		})
	}

	mux.HandleFunc("GET /{$}", a.serveShellPage)
	mux.HandleFunc("GET /view", a.serveShellPage)
	mux.HandleFunc("GET /assets/{name...}", func(w http.ResponseWriter, r *http.Request) {
		a.serveFrontendAsset(w, r.PathValue("name"))
	})
	for path, asset := range noticeAssets {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, _ *http.Request) { a.serveAsset(w, asset) })
	}

	// Projects.
	api("/api/projects", func(w http.ResponseWriter, _ *http.Request, _ url.Values) { a.serveProjects(w) })
	api("/api/directories", func(w http.ResponseWriter, _ *http.Request, query url.Values) {
		a.serveDirectories(w, query.Get("path"))
	})

	// Documents and search.
	api("/api/page", func(w http.ResponseWriter, _ *http.Request, query url.Values) {
		selected, required := query["path"]
		name := ""
		if len(selected) > 0 {
			name = selected[0]
		}
		a.servePageData(w, query.Get("project"), name, query.Get("at"), required)
	})
	api("/api/format", func(w http.ResponseWriter, _ *http.Request, query url.Values) {
		a.serveFormat(w, query.Get("project"), query.Get("path"), query.Get("at"))
	})
	api("/api/search-documents", func(w http.ResponseWriter, _ *http.Request, query url.Values) {
		a.serveSearchDocuments(w, query.Get("project"))
	})
	mux.HandleFunc("GET /api/raw", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		a.serveRaw(w, query.Get("project"), query.Get("path"))
	})
	mux.HandleFunc("GET /api/image", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		a.serveImage(w, contract.ImageRequest{Project: query.Get("project"), Path: query.Get("path"), At: query.Get("at")})
	})

	// Code navigation.
	api("/api/navigation-status", a.serveNavigationStatus)
	api("/api/definition", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveNavigation(w, r, query, false) })
	api("/api/references", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveNavigation(w, r, query, true) })

	// Source Control.
	api("/api/changes", func(w http.ResponseWriter, r *http.Request, query url.Values) {
		a.serveChanges(w, r, query.Get("project"))
	})
	api("/api/diff", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveDiffs(w, r, query) })
	api("/api/commits", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveCommits(w, r, query) })
	api("/api/commit-files", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveCommitFiles(w, r, query) })
	api("/api/branch-files", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveBranchFiles(w, r, query) })
	api("/api/branch-stack", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveBranchStack(w, r, query) })
	api("/api/range-files", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveRangeFiles(w, r, query) })
	api("/api/refs", func(w http.ResponseWriter, _ *http.Request, query url.Values) { a.serveRefs(w, query) })
	api("/api/compare-stats", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveCompareStats(w, r, query) })
	api("/api/blame", func(w http.ResponseWriter, r *http.Request, query url.Values) { a.serveBlame(w, r, query) })

	// Walkthroughs (decision 0047).
	api("/api/walkthroughs", func(w http.ResponseWriter, _ *http.Request, query url.Values) {
		summaries, err := a.app.Walkthroughs.List(query.Get("project"))
		writeResult(w, summaries, err)
	})
	api("/api/walkthrough", func(w http.ResponseWriter, _ *http.Request, query url.Values) {
		stored, err := a.app.Walkthroughs.Get(query.Get("project"), query.Get("id"))
		writeResult(w, stored, err)
	})
	mux.HandleFunc("GET /api/walkthrough-schema", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/schema+json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(a.app.Walkthroughs.Schema())
	})
	mux.HandleFunc("POST /api/walkthroughs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		a.servePublishWalkthrough(w, r)
	})
	mux.HandleFunc("DELETE /api/walkthroughs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		query := r.URL.Query()
		a.serveDeleteWalkthrough(w, r, query.Get("project"), query.Get("id"))
	})

	// Review feedback (decision 0120).
	api("/api/feedback", a.serveFeedback)
	api("/api/feedback-list", func(w http.ResponseWriter, _ *http.Request, query url.Values) {
		summaries, err := a.app.Feedback.List(contract.FeedbackListRequest{Project: query.Get("project")})
		writeResult(w, summaries, err)
	})
	write := func(pattern string, handler http.HandlerFunc) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			handler(w, r)
		})
	}
	write("POST /api/feedback-threads", a.serveCreateFeedbackThread)
	write("POST /api/feedback-messages", a.servePostFeedbackMessage)
	write("DELETE /api/feedback-threads", func(w http.ResponseWriter, r *http.Request) { a.serveDeleteFeedback(w, r, true) })
	write("DELETE /api/feedback", func(w http.ResponseWriter, r *http.Request) { a.serveDeleteFeedback(w, r, false) })

	// Live updates (decision 0050).
	mux.HandleFunc("GET /api/events", a.serveEvents)
	if a.config.Presence {
		mux.HandleFunc("GET /api/presence", a.servePresence)
	}

	api("/api/metrics", func(w http.ResponseWriter, _ *http.Request, _ url.Values) {
		writeJSON(w, http.StatusOK, a.app.Metrics.Sample())
	})
	return mux
}

// serveShellPage serves the app shell. Without a project the browser
// chooses one, so no page data is embedded; /view requires a file unless it
// opens a review, walkthrough, feedback, or Welcome tab.
func (a *App) serveShellPage(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	projectID := query.Get("project")
	if projectID == "" {
		a.serveShell(w, http.StatusOK, nil)
		return
	}
	selected, at := "", ""
	required := r.URL.Path == "/view" && !reviewQuery(query) && !walkthroughQuery(query) && !feedbackQuery(query) && !welcomeQuery(query)
	if required {
		selected, at = query.Get("path"), query.Get("at")
	}
	data, err := a.app.Documents.Page(contract.PageRequest{Project: projectID, Path: selected, At: at, Required: required})
	a.serveShell(w, statusOf(err), &data)
}

// reviewQuery reports a pathless /view that opens a review tab (decision
// 0035): review=working|branch, commit=<hash>, or from=<hash>&to=<hash>.
func reviewQuery(query url.Values) bool {
	return !query.Has("path") && (query.Has("review") || query.Has("commit") || query.Has("from") && query.Has("to"))
}

// walkthroughQuery reports a pathless /view that opens a walkthrough's cover
// tab (decision 0047): wt=<id>.
func walkthroughQuery(query url.Values) bool {
	return !query.Has("path") && query.Get("wt") != ""
}

// feedbackQuery reports a pathless /view that reveals the Feedback view at
// a feedback (decision 0120): fb=<id>.
func feedbackQuery(query url.Values) bool {
	return !query.Has("path") && query.Get("fb") != ""
}

// welcomeQuery reports a pathless /view that opens the Welcome tab (decision
// 0052): welcome=1.
func welcomeQuery(query url.Values) bool {
	return !query.Has("path") && query.Get("welcome") == "1"
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
