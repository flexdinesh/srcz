// Package sandbox names the places zero attaches to, such as running
// containers, and what attaching needs from each: its platform, a way to
// install zero, a way to run it, and its identity (decisions 0127, 0128).
// Providers are listed explicitly in Open. It knows no HTTP or UI.
package sandbox

import (
	"context"
	"fmt"
	"os/exec"
	"path"
	"strings"

	"github.com/flexdinesh/zero/internal/sandbox/docker"
)

// InstallDir is where providers install zero, and its HOME there. `zero
// serve-stdio` deletes its own binary on exit only when it runs from here.
const InstallDir = "/tmp/.zero"

// Environment is a running sandbox zero can be installed in and run in.
type Environment interface {
	// Platform is the sandbox's GOOS/GOARCH, such as linux/arm64.
	Platform(ctx context.Context) (string, error)
	// Install puts the zero release for version in the sandbox and returns
	// its path there.
	Install(ctx context.Context, version string) (string, error)
	// Exec returns an unstarted host command that runs argv in the sandbox
	// with env added, wired to the command's standard input and output. Only
	// its Path, Args, and Env carry over.
	Exec(ctx context.Context, argv, env []string) (*exec.Cmd, error)
	// Identity names the running sandbox for a saved connection (decision
	// 0128): Open(provider, ref) reaches it again, and engine names what runs
	// it. Neither is a secret.
	Identity(ctx context.Context) (ref, engine string, err error)
}

// Target is a sandbox and the directory to serve in it.
type Target struct {
	Environment Environment
	// Provider and Ref are as the target names them, such as docker and web.
	Provider string
	Ref      string
	// Path is absolute, or "." for the sandbox's working directory.
	Path string
}

// String is the target in ParseTarget's form.
func (t Target) String() string {
	text := t.Provider + "://" + t.Ref
	if t.Path != "." {
		text += t.Path
	}
	return text
}

// ParseTarget reads `<provider>://<ref>[/<absolute path>]`, such as
// docker://web/src.
func ParseTarget(text string) (Target, error) {
	provider, rest, ok := strings.Cut(text, "://")
	if !ok {
		return Target{}, fmt.Errorf("%q is not a sandbox: use docker://<container>[/path]", text)
	}
	ref, dir, hasPath := strings.Cut(rest, "/")
	target := Target{Provider: provider, Ref: ref, Path: "."}
	if hasPath {
		target.Path = path.Clean("/" + dir)
	}
	environment, err := Open(provider, ref)
	if err != nil {
		return Target{}, err
	}
	target.Environment = environment
	return target, nil
}

// Open returns the sandbox that ref names to provider. Its one switch lists
// the providers.
func Open(provider, ref string) (Environment, error) {
	switch provider {
	case "docker":
		container, err := docker.New(ref, InstallDir)
		if err != nil {
			return nil, err
		}
		return container, nil
	}
	return nil, fmt.Errorf("zero cannot attach to %s:// sandboxes; it supports docker://", provider)
}
