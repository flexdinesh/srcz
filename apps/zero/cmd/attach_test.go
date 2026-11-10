package cmd

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/flexdinesh/zero/internal/daemon"
	"github.com/flexdinesh/zero/internal/desktopapp"
	"github.com/flexdinesh/zero/internal/sandbox"
	"github.com/flexdinesh/zero/pkg/connection"
	"github.com/flexdinesh/zero/pkg/contract"
)

// cliEnv runs this test binary as zero (TestMain), with its own user dirs.
func cliEnv(t *testing.T) []string {
	t.Helper()
	home := t.TempDir()
	return append(os.Environ(), "ZERO_CMD_TEST_EXEC=1", "HOME="+home, "XDG_CONFIG_HOME="+filepath.Join(home, "config"), "XDG_CACHE_HOME="+filepath.Join(home, "cache"))
}

func TestServeStdioServesTheWebAppOnStandardInputAndOutput(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# hi\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	transport := connection.Exec{Argv: []string{self, "serve-stdio", "--", dir}, Env: cliEnv(t)}.Transport()
	defer func() { _ = transport.Close() }()
	info, err := transport.Connect(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if info.Protocol != daemon.ProtocolVersion || info.Version == "" || info.Name == "" {
		t.Fatalf("info = %+v", info)
	}
	projects := getProjects(t, &http.Client{Transport: transport}, "http://localhost/")
	if len(projects.Roots) != 1 || projects.Roots[0].Path != dir {
		t.Fatalf("roots = %+v, want %s", projects.Roots, dir)
	}
}

func TestServeStdioFailsForAMissingPath(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "missing")
	transport := connection.Exec{Argv: []string{self, "serve-stdio", "--", missing}, Env: cliEnv(t)}.Transport()
	defer func() { _ = transport.Close() }()
	if _, err := transport.Connect(t.Context()); err == nil || !strings.Contains(err.Error(), missing) {
		t.Fatalf("Connect = %v, want the path in the error", err)
	}
}

// attachDocker plays the docker CLI for a container whose zero is this test
// binary: `exec` runs it here.
const attachDocker = `#!/bin/sh
[ -z "$ZERO_ATTACH_TEST_LOG" ] || printf '%s\n' "$*" >> "$ZERO_ATTACH_TEST_LOG"
case "$1" in
inspect) if [ "$5" = "{{.Id}}" ]; then echo 3f2a9c1b7d4e0000; else echo "true sha256:img"; fi ;;
info) echo engine-1 ;;
image) echo "linux/amd64" ;;
create) echo created ;;
cp) [ "$2" = "--archive" ] || printf zero > "$3" ;;
rm) ;;
exec)
	shift 6
	exec "$ZERO_ATTACH_TEST_BIN" "$@" ;;
*) echo "unexpected $1" >&2; exit 2 ;;
esac
`

// lockedBuffer is a bytes.Buffer safe for one writer and one reader.
type lockedBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

// fakeAttachDocker puts attachDocker first on PATH for this process and the
// ones it starts, which run this test binary as zero with their own user
// dirs. It returns the file docker logs its calls to.
func fakeAttachDocker(t *testing.T) string {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(attachDocker), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, value := range cliEnv(t) {
		name, value, _ := strings.Cut(value, "=")
		if name == "ZERO_CMD_TEST_EXEC" || name == "HOME" || strings.HasPrefix(name, "XDG_") {
			t.Setenv(name, value)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("ZERO_ATTACH_TEST_BIN", self)
	log := filepath.Join(bin, "log")
	t.Setenv("ZERO_ATTACH_TEST_LOG", log)
	return log
}

func TestAttachServesTheContainersFilesToTheBrowser(t *testing.T) {
	fakeAttachDocker(t)
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	var stdout, stderr lockedBuffer
	done := make(chan error, 1)
	go func() {
		done <- runAttach(ctx, attachOptions{target: "docker://web" + dir, portSet: true, noOpen: true}, &stdout, &stderr)
	}()
	link := regexp.MustCompile(`http://127\.0\.0\.1:[0-9]+/`)
	deadline := time.Now().Add(20 * time.Second)
	for !link.MatchString(stdout.String()) {
		select {
		case err := <-done:
			t.Fatalf("attach ended: %v\n%s%s", err, stdout.String(), stderr.String())
		default:
		}
		if time.Now().After(deadline) {
			t.Fatalf("no web link:\n%s%s", stdout.String(), stderr.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !strings.Contains(stdout.String(), "attached to:  docker://web"+dir) {
		t.Fatalf("startup:\n%s", stdout.String())
	}
	base := link.FindString(stdout.String())
	client := &http.Client{}
	projects := getProjects(t, client, base)
	if len(projects.Roots) != 1 || projects.Roots[0].Path != dir || len(projects.Projects) == 0 {
		t.Fatalf("projects = %+v, want root %s", projects, dir)
	}

	// An event stream stays open beside other requests, and ends on stop.
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"api/events?project="+url.QueryEscape(projects.Projects[0].ID), nil)
	if err != nil {
		t.Fatal(err)
	}
	events, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = events.Body.Close() }()
	stream := bufio.NewReader(events.Body)
	if line, err := stream.ReadString('\n'); line != ": zero\n" {
		t.Fatalf("first event line = %q, %v", line, err)
	}
	getProjects(t, client, base)

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("attach = %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("attach did not stop")
	}
	ended := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, stream)
		close(ended)
	}()
	select {
	case <-ended:
	case <-time.After(5 * time.Second):
		t.Fatal("event stream still open after stop")
	}
}

func getProjects(t *testing.T, client *http.Client, base string) contract.ProjectsResponse {
	t.Helper()
	response, err := client.Get(base + "api/projects")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	var projects contract.ProjectsResponse
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET api/projects: %s", response.Status)
	}
	if err := json.NewDecoder(response.Body).Decode(&projects); err != nil {
		t.Fatal(err)
	}
	return projects
}

func TestAttachRejectsBadTargetsAndPorts(t *testing.T) {
	for _, args := range [][]string{{"attach"}, {"attach", "web"}, {"attach", "podman://web"}, {"attach", "--port", "70000", "docker://web"}} {
		command := newRootCommandWith(nil, nil)
		command.SetArgs(args)
		command.SetOut(&bytes.Buffer{})
		command.SetErr(&bytes.Buffer{})
		if err := command.Execute(); err == nil {
			t.Errorf("zero %s succeeded", strings.Join(args, " "))
		}
	}
}

func TestServeStdioIsHidden(t *testing.T) {
	command := newRootCommandWith(nil, nil)
	found, _, err := command.Find([]string{"serve-stdio"})
	if err != nil || found.Name() != "serve-stdio" || !found.Hidden {
		t.Fatalf("serve-stdio = %v, %v", found, err)
	}
}

// desktopAttachDeps play a Linux desktop with the app installed, recording
// what it opens and whether browser mode ran.
func desktopAttachDeps(t *testing.T, opened *[]string, browsed *bool) attachDeps {
	t.Helper()
	return attachDeps{
		goos:      "linux",
		getenv:    func(name string) string { return map[string]string{"DISPLAY": ":0"}[name] },
		terminal:  func(io.Writer) bool { return false },
		storePath: connection.DefaultStorePath,
		installed: func(context.Context) (bool, error) { return true, nil },
		openApp: func(_ context.Context, link string) error {
			*opened = append(*opened, link)
			return nil
		},
		now: func() time.Time { return time.Date(2026, 11, 11, 1, 2, 3, 0, time.UTC) },
		browser: func(context.Context, attachOptions, sandbox.Target, io.Writer, io.Writer) error {
			*browsed = true
			return nil
		},
	}
}

func TestAttachSavesTheSandboxAndOpensItInTheDesktopApp(t *testing.T) {
	log := fakeAttachDocker(t)
	dir := t.TempDir()
	var opened []string
	var browsed bool
	var stdout, stderr bytes.Buffer
	err := attachWith(t.Context(), attachOptions{cliName: "zero", target: "docker://web" + dir}, &stdout, &stderr, desktopAttachDeps(t, &opened, &browsed))
	if err != nil {
		t.Fatalf("attach = %v\n%s", err, stderr.String())
	}
	id := connection.SandboxID("docker", "engine-1", "3f2a9c1b7d4e0000")
	if browsed || !slices.Equal(opened, []string{"zero://" + id + "/"}) {
		t.Fatalf("opened %q, browsed %v", opened, browsed)
	}
	if !strings.Contains(stdout.String(), "attached to docker://web"+dir+" (zero ") || !strings.Contains(stdout.String(), "desktop: zero://"+id+"/") {
		t.Fatalf("stdout = %q", stdout.String())
	}
	path, err := connection.DefaultStorePath()
	if err != nil {
		t.Fatal(err)
	}
	saved, found, err := connection.NewStore(path).Lookup(id)
	want := connection.Saved{ID: id, Label: "docker://web" + dir, AddedAt: time.Date(2026, 11, 11, 1, 2, 3, 0, time.UTC), Sandbox: &connection.SavedSandbox{Provider: "docker", Ref: "3f2a9c1b7d4e0000", Path: dir}}
	if err != nil || !found || !reflect.DeepEqual(saved, want) {
		t.Fatalf("saved = %+v, %t, %v, want %+v", saved, found, err, want)
	}
	// The check installed and ran zero once, and it has exited.
	if installs := strings.Count(readFile(t, log), "cp --archive"); installs != 1 {
		t.Fatalf("installs = %d", installs)
	}

	// The app reaches the saved sandbox through `zero connection stdio`, which
	// installs zero again for every run: zero deletes itself when it stops.
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := saved.Endpoint(self)
	if err != nil {
		t.Fatal(err)
	}
	for run := 2; run <= 3; run++ {
		transport := endpoint.RoundTripper()
		projects := getProjects(t, &http.Client{Transport: transport}, endpoint.BaseURL()+"/")
		if len(projects.Roots) != 1 || projects.Roots[0].Path != dir {
			t.Fatalf("roots = %+v, want %s", projects.Roots, dir)
		}
		if closer, ok := transport.(io.Closer); !ok || closer.Close() != nil {
			t.Fatal("the transport does not close")
		}
		if installs := strings.Count(readFile(t, log), "cp --archive"); installs != run {
			t.Fatalf("installs after run %d = %d", run, installs)
		}
	}
	if !strings.Contains(readFile(t, log), "exec --interactive --env HOME=/tmp/.zero 3f2a9c1b7d4e0000 /tmp/.zero/zero serve-stdio -- "+dir) {
		t.Fatalf("docker calls:\n%s", readFile(t, log))
	}
}

func TestConnectionStdioRefusesWhatIsNotASavedSandbox(t *testing.T) {
	fakeAttachDocker(t)
	path, err := connection.DefaultStorePath()
	if err != nil {
		t.Fatal(err)
	}
	remote := connection.Saved{ID: "r-000000000001", Label: "box", TLS: &connection.SavedTLS{Hosts: []string{"10.0.0.5"}, Port: 7971, Credential: "x"}}
	if err := connection.NewStore(path).Put(remote); err != nil {
		t.Fatal(err)
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"s-000000000001", "r-000000000001"} {
		transport := connection.Exec{Argv: []string{self, "connection", "stdio", id}}.Transport()
		_, err := transport.Connect(t.Context())
		_ = transport.Close()
		if err == nil || !strings.Contains(err.Error(), "no saved sandbox connection "+id) {
			t.Errorf("connection stdio %s = %v", id, err)
		}
	}
}

func TestAttachServesTheBrowserWhenTheAppCannotOpen(t *testing.T) {
	tests := []struct {
		name   string
		opts   attachOptions
		change func(*attachDeps)
		notice string
	}{
		{name: "--browser", opts: attachOptions{browser: true}},
		{name: "--port", opts: attachOptions{portSet: true}},
		{name: "ssh", change: func(d *attachDeps) {
			d.getenv = func(name string) string { return map[string]string{"SSH_CONNECTION": "1", "DISPLAY": ":0"}[name] }
		}},
		{name: "no display", change: func(d *attachDeps) { d.getenv = func(string) string { return "" } }},
		{name: "windows", change: func(d *attachDeps) { d.goos = "windows" }},
		{name: "not installed", change: func(d *attachDeps) {
			d.installed = func(context.Context) (bool, error) { return false, nil }
		}, notice: "serving in browser mode"},
		{name: "open fails", change: func(d *attachDeps) {
			d.openApp = func(context.Context, string) error { return desktopapp.ErrNotInstalled }
		}, notice: "serving in browser mode"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fakeAttachDocker(t)
			var opened []string
			var browsed bool
			deps := desktopAttachDeps(t, &opened, &browsed)
			if test.change != nil {
				test.change(&deps)
			}
			opts := test.opts
			opts.cliName, opts.target = "zero", "docker://web"+t.TempDir()
			var stdout, stderr bytes.Buffer
			if err := attachWith(t.Context(), opts, &stdout, &stderr, deps); err != nil {
				t.Fatal(err)
			}
			if !browsed || len(opened) != 0 {
				t.Fatalf("browsed %v, opened %q", browsed, opened)
			}
			if !strings.Contains(stderr.String(), test.notice) {
				t.Fatalf("stderr = %q, want %q", stderr.String(), test.notice)
			}
		})
	}
}

func TestAttachNoOpenSavesAndPrintsTheLink(t *testing.T) {
	fakeAttachDocker(t)
	var opened []string
	var browsed bool
	deps := desktopAttachDeps(t, &opened, &browsed)
	deps.installed = func(context.Context) (bool, error) { return false, errors.New("not asked") }
	var stdout, stderr bytes.Buffer
	if err := attachWith(t.Context(), attachOptions{cliName: "zero", target: "docker://web" + t.TempDir(), noOpen: true}, &stdout, &stderr, deps); err != nil {
		t.Fatal(err)
	}
	id := connection.SandboxID("docker", "engine-1", "3f2a9c1b7d4e0000")
	if browsed || len(opened) != 0 || !strings.Contains(stdout.String(), "desktop: zero://"+id+"/") {
		t.Fatalf("browsed %v, opened %q, stdout %q", browsed, opened, stdout.String())
	}
}

func TestConnectionIsHidden(t *testing.T) {
	command := newRootCommandWith(nil, nil)
	found, _, err := command.Find([]string{"connection", "stdio"})
	if err != nil || found.Name() != "stdio" || !found.Parent().Hidden {
		t.Fatalf("connection stdio = %v, %v", found, err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
