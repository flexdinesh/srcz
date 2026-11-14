// Package app is zero's transport-agnostic application layer (decision
// 0080): per-domain services whose operations take and return pkg/contract
// types and fail with *Error (a kind and an optional code). It knows no HTTP;
// internal/web adapts it to HTTP, and pkg/client calls it in process.
package app

import (
	"errors"
	"io/fs"
	"os"
	"strings"

	"github.com/flexdinesh/zero/internal/document"
	"github.com/flexdinesh/zero/internal/feedback"
	"github.com/flexdinesh/zero/internal/files"
	"github.com/flexdinesh/zero/internal/lsp"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/internal/walkthrough"
	"github.com/flexdinesh/zero/internal/watch"
)

// Config composes the application. Roots confine every project; ScanDepth
// bounds repository discovery; Depth bounds the file scan within a project.
type Config struct {
	// Roots is required; each operation reads one snapshot, so it may grow
	// while serving.
	Roots     *projects.RootSet
	ScanDepth int
	Depth     int
	// Types decides presentation and is required; every file within Depth is
	// in scope.
	Types *document.Registry
	// LanguageServers answers code navigation; nil serves none. Its owner
	// closes it.
	LanguageServers *lsp.Manager
	// SessionKey names the session whose browser memory a page reads; empty
	// uses the roots joined by newlines.
	SessionKey string
	// Presence reports that pages should hold /api/presence while open.
	Presence bool
	// OpenFile opens indexed files; nil uses os.Open.
	OpenFile func(name string) (fs.File, error)
	// Watches follows projects for live updates; Events requires it.
	Watches *watch.Hub
	// StatsBudget bounds the bytes one compare-stats read takes; zero or
	// less uses DefaultStatsBudget.
	StatsBudget int64
	// WalkthroughDirectory stores published walkthroughs; empty uses
	// walkthrough.DefaultDirectory.
	WalkthroughDirectory string
	// FeedbackDirectory stores review feedback; empty uses
	// feedback.DefaultDirectory.
	FeedbackDirectory string
	// RootControl opens folders anywhere on the host and stops serving
	// roots (decision 0146); nil serves Roots as they are.
	RootControl RootControl
}

// App holds the domain services. Each is safe for concurrent use.
type App struct {
	Projects      *Projects
	Documents     *Documents
	Events        *Events
	SourceControl *SourceControl
	Navigation    *Navigation
	Metrics       *Metrics
	Walkthroughs  *Walkthroughs
	Feedback      *Feedback
}

// state is the configuration every service shares.
type state struct {
	config Config
}

// New composes the services over config.
func New(config Config) (*App, error) {
	if config.Roots == nil {
		return nil, errors.New("app: no roots")
	}
	if config.Types == nil {
		return nil, errors.New("app: no document types")
	}
	if config.LanguageServers == nil {
		config.LanguageServers = lsp.NewManager(nil, lsp.Options{})
	}
	if config.OpenFile == nil {
		config.OpenFile = func(name string) (fs.File, error) { return os.Open(name) }
	}
	if config.WalkthroughDirectory == "" {
		directory, err := walkthrough.DefaultDirectory()
		if err != nil {
			return nil, err
		}
		config.WalkthroughDirectory = directory
	}
	if config.FeedbackDirectory == "" {
		directory, err := feedback.DefaultDirectory()
		if err != nil {
			return nil, err
		}
		config.FeedbackDirectory = directory
	}
	shared := &state{config: config}
	targets := walkthroughTargets{roots: config.Roots, depth: config.Depth, types: config.Types, openFile: config.OpenFile}
	walkthroughs := &Walkthroughs{state: shared, service: walkthrough.NewService(walkthrough.NewStore(config.WalkthroughDirectory), targets)}
	reviews := &Feedback{state: shared, service: feedback.NewService(feedback.NewStore(config.FeedbackDirectory))}
	return &App{
		Projects:      &Projects{state: shared},
		Documents:     &Documents{state: shared},
		Events:        &Events{state: shared, notices: &walkthroughs.notices, feedback: &reviews.notices},
		SourceControl: &SourceControl{state: shared, blames: newBlameCache()},
		Navigation:    &Navigation{state: shared, servers: config.LanguageServers},
		Metrics:       &Metrics{},
		Walkthroughs:  walkthroughs,
		Feedback:      reviews,
	}, nil
}

// navigationSupported reports whether a family has a language server
// (page-level navigationSupported).
func (s *state) navigationSupported(family string) bool {
	_, ok := s.config.LanguageServers.ServerFor(family)
	return ok
}

// sessionKey names the session whose browser memory a page reads:
// Config.SessionKey, else the served roots joined by newlines.
func (s *state) sessionKey(roots []string) string {
	if s.config.SessionKey != "" {
		return s.config.SessionKey
	}
	return strings.Join(roots, "\n")
}

func (s *state) scan(root string) (*files.Index, error) {
	return files.Scan(root, s.config.Depth, func(string) bool { return true })
}

func warningStrings(warnings []files.Warning) []string {
	result := make([]string, len(warnings))
	for i, warning := range warnings {
		result[i] = warning.Error()
	}
	return result
}

// mapSlice maps values, keeping nil nil so encodings match the domain's.
func mapSlice[T, U any](values []T, convert func(T) U) []U {
	if values == nil {
		return nil
	}
	result := make([]U, len(values))
	for i, value := range values {
		result[i] = convert(value)
	}
	return result
}
