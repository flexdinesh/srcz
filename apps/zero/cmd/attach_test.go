package cmd

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/flexdinesh/zero/internal/daemon"
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
case "$1" in
inspect) echo "true sha256:img" ;;
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

func TestAttachServesTheContainersFilesToTheBrowser(t *testing.T) {
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
