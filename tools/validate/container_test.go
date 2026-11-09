//go:build linux || darwin

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

// fakeDocker records every call. Builds write an image ID, compose run fails
// on request, and cp exports a status file.
type fakeDocker struct {
	mu        sync.Mutex
	calls     []fakeCall
	failRun   bool
	blockRun  chan struct{}
	exitCode  int
	listing   map[string]string
	cancelled []bool
}

type fakeCall struct {
	args []string
	env  []string
}

func (f *fakeDocker) record(ctx context.Context, env []string, args []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, fakeCall{append([]string{}, args...), append([]string{}, env...)})
	f.cancelled = append(f.cancelled, ctx.Err() != nil)
}

func (f *fakeDocker) run(ctx context.Context, env []string, out io.Writer, _ []*os.File, args ...string) error {
	f.record(ctx, env, args)
	if args[0] == "buildx" {
		for i, arg := range args {
			if arg == "--iidfile" {
				return os.WriteFile(args[i+1], []byte("sha256:abc\n"), 0600)
			}
		}
	}
	if slices.Contains(args, "run") && args[0] == "compose" {
		if f.blockRun != nil {
			close(f.blockRun)
			<-ctx.Done()
			return ctx.Err()
		}
		if f.failRun {
			return errors.New("exit status 125")
		}
	}
	return nil
}

func (f *fakeDocker) output(ctx context.Context, args ...string) (string, error) {
	f.record(ctx, nil, args)
	if args[0] == "cp" {
		dest := args[2]
		if err := os.MkdirAll(dest, 0700); err != nil {
			return "", err
		}
		status := []byte(`{"exitCode":` + string(rune('0'+f.exitCode)) + "}\n")
		if err := os.WriteFile(filepath.Join(dest, "status.json"), status, 0600); err != nil {
			return "", err
		}
		return "", os.WriteFile(filepath.Join(dest, "environment.txt"), []byte("linux\n"), 0600)
	}
	return f.listing[strings.Join(args, " ")], nil
}

func (f *fakeDocker) commands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, c := range f.calls {
		out = append(out, strings.Join(c.args, " "))
	}
	return out
}

func (f *fakeDocker) find(prefix string) (fakeCall, int, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, c := range f.calls {
		if strings.HasPrefix(strings.Join(c.args, " "), prefix) {
			return c, i, true
		}
	}
	return fakeCall{}, -1, false
}

func testJob(t *testing.T, d docker, group string) containerJob {
	t.Helper()
	dir := t.TempDir()
	out := filepath.Join(dir, "out")
	if err := os.MkdirAll(out, 0700); err != nil {
		t.Fatal(err)
	}
	return containerJob{Docker: d, Slot: 1, Group: group, Attempt: "attempt", Contexts: filepath.Join(dir, "ctx"), Out: out}
}

func TestNamesAreRepositoryAndSlotScoped(t *testing.T) {
	if got := projectName(1, "browser-extended"); got != "srcz-check-s1-browser-extended" {
		t.Fatal(got)
	}
	if got := imageTag(0, "browser"); got != "srcz-check:s0-browser" {
		t.Fatal(got)
	}
	if containerTask("go", "") != "_container:go" || containerTask("go", "_container:test:go") != "_container:test:go" {
		t.Fatal("container task names")
	}
	for group, target := range groupTargets {
		if isHostGroup(group) || targetContexts[target] == nil {
			t.Fatalf("group %s has no container target", group)
		}
	}
	for _, group := range append(append([]string{}, groups...), extendedGroups...) {
		if _, ok := groupTargets[group]; ok == isHostGroup(group) {
			t.Fatalf("group %s target mapping does not match its location", group)
		}
	}
}

func TestBuildUsesSnapshotDockerfileAndNamedContexts(t *testing.T) {
	d := &fakeDocker{}
	job := testJob(t, d, "webkit")
	job.Force = true
	image, err := job.build(context.Background())
	if err != nil || image != "sha256:abc" {
		t.Fatalf("build: %q %v", image, err)
	}
	call, _, _ := d.find("buildx build")
	args := strings.Join(call.args, " ")
	for _, want := range []string{
		"--target browser", "--tag srcz-check:s1-browser", "--load", "--platform linux/amd64",
		"--file " + filepath.Join(job.Contexts, "ctx-src", "tools", "validate", "Dockerfile"),
		"--build-context ctx-bin=" + filepath.Join(job.Contexts, "ctx-bin"),
		"--build-context ctx-src=" + filepath.Join(job.Contexts, "ctx-src"),
		"--no-cache-filter source,web,binary,browser",
	} {
		if !strings.Contains(args, want) {
			t.Fatalf("build lacks %q: %s", want, args)
		}
	}
	if strings.Contains(args, "ctx-desktopmod") {
		t.Fatal("browser build received the desktop module context")
	}
	job.Force = false
	d.calls = nil
	if _, err := job.build(context.Background()); err != nil {
		t.Fatal(err)
	}
	call, _, _ = d.find("buildx build")
	if strings.Contains(strings.Join(call.args, " "), "--no-cache-filter") {
		t.Fatal("ordinary builds must reuse every cached stage")
	}
}

func TestExecuteExportsArtifactsAndTearsDown(t *testing.T) {
	d := &fakeDocker{listing: map[string]string{"ps --all --quiet --filter label=com.docker.compose.project=srcz-check-s1-browser-extended": "c1\n"}}
	job := testJob(t, d, "browser-extended")
	job.Args = []string{"tests/browser/app.spec.ts"}
	if err := job.execute(context.Background(), "sha256:abc"); err != nil {
		t.Fatal(err)
	}
	run, runIndex, ok := d.find("compose --project-name srcz-check-s1-browser-extended")
	if !ok {
		t.Fatal("compose run missing")
	}
	runArgs := strings.Join(run.args, " ")
	if !strings.Contains(runArgs, "run --no-TTY --name srcz-check-s1-browser-extended-runner") || !strings.HasSuffix(runArgs, "runner mise run --force --skip-deps _container:browser-extended tests/browser/app.spec.ts") {
		t.Fatalf("compose run: %s", runArgs)
	}
	for _, want := range []string{"SRCZ_CHECK_IMAGE=sha256:abc", "SRCZ_BROWSER_EXTENDED=1", "SRCZ_VALIDATION_FORCE=false"} {
		if !slices.Contains(run.env, want) {
			t.Fatalf("compose env lacks %s: %v", want, run.env)
		}
	}
	_, volumeIndex, _ := d.find("volume create --label io.srcz.validation=cache srcz-check-go-build")
	_, cpIndex, _ := d.find("cp srcz-check-s1-browser-extended-runner:/out " + filepath.Join(job.Out, "output"))
	_, rmIndex, _ := d.find("rm --force --volumes c1")
	down, downAt, _ := findLast(d, "down --volumes --remove-orphans")
	if volumeIndex < 0 || volumeIndex > runIndex || cpIndex < runIndex || rmIndex < cpIndex || downAt < rmIndex {
		t.Fatalf("lifecycle order wrong: %v", d.commands())
	}
	if !slices.Contains(down.args, "--project-name") {
		t.Fatal("down not scoped to the project")
	}
	if _, err := os.Stat(filepath.Join(job.Out, "output", "status.json")); err != nil {
		t.Fatal("artifacts not exported")
	}
}

func TestExecuteTearsDownAfterFailureAndCancellation(t *testing.T) {
	failed := &fakeDocker{failRun: true}
	if err := testJob(t, failed, "go").execute(context.Background(), "sha256:abc"); err == nil {
		t.Fatal("failed compose run reported success")
	}
	if _, _, ok := findLast(failed, "down --volumes"); !ok {
		t.Fatal("no teardown after failure")
	}
	if _, _, ok := failed.find("cp srcz-check-s1-go-runner:/out"); !ok {
		t.Fatal("failure artifacts not exported")
	}

	blocked := &fakeDocker{blockRun: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { <-blocked.blockRun; cancel() }()
	if err := testJob(t, blocked, "go").execute(ctx, "sha256:abc"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	_, index, ok := findLast(blocked, "down --volumes")
	if !ok || blocked.cancelled[index] {
		t.Fatal("teardown skipped or ran with the cancelled context")
	}
	_, psIndex, _ := blocked.find("ps --all --quiet --filter label=com.docker.compose.project=srcz-check-s1-go")
	if psIndex < 0 || blocked.cancelled[psIndex] {
		t.Fatal("cancelled run left its containers")
	}
}

func TestSweepRemovesOnlyThisSlotsResources(t *testing.T) {
	d := &fakeDocker{listing: map[string]string{
		`ps --all --filter label=com.docker.compose.project --format {{.Label "com.docker.compose.project"}}`:   "srcz-check-s1-go\nsrcz-check-s0-go\ndiffx-check-s1-go\nsrcz-check-s10-docs\n",
		`network ls --filter label=com.docker.compose.project --format {{.Label "com.docker.compose.project"}}`: "srcz-check-s1-browser\nsrcz-dev\n",
		"ps --all --quiet --filter label=com.docker.compose.project=srcz-check-s1-go":                           "a\n",
		"network ls --quiet --filter label=com.docker.compose.project=srcz-check-s1-browser":                    "n1\n",
		"image ls srcz-check --format {{.Tag}}":                                                                 "s1-go\ns0-go\ns1-browser\ns10-docs\n",
	}}
	if err := sweepSlot(context.Background(), d, 1); err != nil {
		t.Fatal(err)
	}
	commands := strings.Join(d.commands(), "\n")
	for _, want := range []string{"rm --force --volumes a", "network rm n1", "image rm srcz-check:s1-browser srcz-check:s1-go"} {
		if !strings.Contains(commands, want) {
			t.Fatalf("sweep missed %q:\n%s", want, commands)
		}
	}
	// Removals and per-project queries name only slot 1 resources.
	for _, line := range d.commands() {
		if !strings.Contains(line, " rm ") && !strings.HasPrefix(line, "rm ") && !strings.Contains(line, "project=") {
			continue
		}
		for _, foreign := range []string{"s0-go", "diffx-check", "s10-docs", "srcz-dev"} {
			if strings.Contains(line, foreign) {
				t.Fatalf("sweep touched %s: %s", foreign, line)
			}
		}
	}
}

func TestDockerEnvironmentPassesOnlyDaemonAccess(t *testing.T) {
	t.Setenv("SRCZ_API_TARGET", "http://localhost:9999")
	t.Setenv("GITHUB_TOKEN", "secret")
	t.Setenv("DOCKER_HOST", "unix:///run/user/docker.sock")
	env := strings.Join(dockerEnvironment(), "\n")
	for _, leaked := range []string{"secret", "http://localhost"} {
		if strings.Contains(env, leaked) {
			t.Fatalf("host configuration leaked: %s", leaked)
		}
	}
	if !strings.Contains(env, "DOCKER_HOST=unix:///run/user/docker.sock") {
		t.Fatal("daemon address dropped")
	}
	job := containerJob{Group: "desktop-extended", Attempt: "a"}
	if got := job.composeEnvironment("sha256:x"); !slices.Equal(got, []string{"SRCZ_CHECK_IMAGE=sha256:x", "SRCZ_VALIDATION_ATTEMPT=a", "SRCZ_VALIDATION_FORCE=false", "SRCZ_DESKTOP_EXTENDED=1"}) {
		t.Fatalf("compose environment: %v", got)
	}
}

// The committed compose file keeps the isolation the runner promises.
func TestComposeFileIsolatesRunner(t *testing.T) {
	raw, err := os.ReadFile("compose.yaml")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, want := range []string{"internal: true", "external: true", "name: srcz-check-go-build", "init: true", "cpus: 2", "mem_limit: 4g", "pull_policy: never"} {
		if !strings.Contains(text, want) {
			t.Fatalf("compose.yaml lacks %q", want)
		}
	}
	for _, forbidden := range []string{"ports:", "network_mode", "docker.sock", "privileged", "host.docker.internal", "extra_hosts"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("compose.yaml contains %q", forbidden)
		}
	}
}

// Every group target carries the capture that writes status.json.
func TestEveryTargetCopiesTheCapture(t *testing.T) {
	raw, err := os.ReadFile("Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for target := range targetContexts {
		marker := " AS " + target + "\nCOPY --from=capture /usr/local/bin/srcz-check-capture /usr/local/bin/srcz-check-capture\n"
		if !strings.Contains(text, marker) {
			t.Fatalf("target %s does not start by copying the capture", target)
		}
	}
}

func findLast(d *fakeDocker, fragment string) (fakeCall, int, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i := len(d.calls) - 1; i >= 0; i-- {
		if strings.Contains(strings.Join(d.calls[i].args, " "), fragment) {
			return d.calls[i], i, true
		}
	}
	return fakeCall{}, -1, false
}
