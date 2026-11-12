package docker

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// fakeDocker answers as the docker CLI would, logging each call to log. The
// FAKE_DOCKER_* variables pick its answers.
const fakeDocker = `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
inspect)
	case "$FAKE_DOCKER_STATE" in
	missing) echo "Error response from daemon: No such container: $6" >&2; exit 1 ;;
	stopped) echo "false sha256:img" ;;
	*) if [ "$5" = "{{.Id}}" ]; then echo 3f2a9c1b7d4e0000; else echo "true sha256:img"; fi ;;
	esac ;;
info) echo engine-1 ;;
image) echo "${FAKE_DOCKER_PLATFORM:-linux/arm64}" ;;
create)
	if [ -n "$FAKE_DOCKER_PULL_ERROR" ]; then
		echo "Unable to find image locally" >&2
		echo "$FAKE_DOCKER_PULL_ERROR" >&2
		exit 1
	fi
	echo created123 ;;
cp)
	if [ "$2" = "--archive" ]; then
		if [ -n "$FAKE_DOCKER_CP_ERROR" ]; then echo "$FAKE_DOCKER_CP_ERROR" >&2; exit 1; fi
		mkdir -p "$FAKE_DOCKER_ROOT" && cp -R "$3" "$FAKE_DOCKER_ROOT/"
	else
		printf 'zero binary' > "$3"
	fi ;;
rm) ;;
*) echo "unexpected $1" >&2; exit 2 ;;
esac
`

type fake struct {
	dir  string
	log  string
	root string
}

func installFake(t *testing.T) fake {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(fakeDocker), 0o755); err != nil {
		t.Fatal(err)
	}
	f := fake{dir: dir, log: filepath.Join(dir, "log"), root: filepath.Join(dir, "container")}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_DOCKER_LOG", f.log)
	t.Setenv("FAKE_DOCKER_ROOT", f.root)
	return f
}

func (f fake) calls(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile(f.log)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(data)), "\n")
}

var web = Container{Name: "web", Dir: "/tmp/.zero"}

func TestPlatformIsTheImagesPlatform(t *testing.T) {
	f := installFake(t)
	t.Setenv("FAKE_DOCKER_PLATFORM", "linux/amd64")
	got, err := web.Platform(t.Context())
	if err != nil || got != "linux/amd64" {
		t.Fatalf("Platform = %q, %v", got, err)
	}
	want := []string{
		"inspect --type container --format {{.State.Running}} {{.Image}} web",
		"image inspect --format {{.Os}}/{{.Architecture}} sha256:img",
	}
	if calls := f.calls(t); strings.Join(calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls = %q, want %q", calls, want)
	}
}

func TestPlatformExplainsMissingAndStoppedContainers(t *testing.T) {
	installFake(t)
	t.Setenv("FAKE_DOCKER_STATE", "missing")
	if _, err := web.Platform(t.Context()); err == nil || !strings.Contains(err.Error(), `no container "web"`) {
		t.Fatalf("missing: %v", err)
	}
	t.Setenv("FAKE_DOCKER_STATE", "stopped")
	if _, err := web.Platform(t.Context()); err == nil || !strings.Contains(err.Error(), `container "web" is not running`) {
		t.Fatalf("stopped: %v", err)
	}
}

func TestIdentityIsTheContainerAndEngineIDs(t *testing.T) {
	f := installFake(t)
	ref, engine, err := web.Identity(t.Context())
	if err != nil || ref != "3f2a9c1b7d4e0000" || engine != "engine-1" {
		t.Fatalf("Identity = %q, %q, %v", ref, engine, err)
	}
	want := []string{"inspect --type container --format {{.Id}} web", "info --format {{.ID}}"}
	if calls := f.calls(t); strings.Join(calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls = %q, want %q", calls, want)
	}
	t.Setenv("FAKE_DOCKER_STATE", "missing")
	if _, _, err := web.Identity(t.Context()); err == nil || !strings.Contains(err.Error(), `no container "web"`) {
		t.Fatalf("missing: %v", err)
	}
}

// withInstallDirs replaces where docker is looked for off PATH.
func withInstallDirs(t *testing.T, dirs ...string) {
	t.Helper()
	saved := installDirs
	installDirs = dirs
	t.Cleanup(func() { installDirs = saved })
}

func TestDockerOffPathIsFoundWhereItInstalls(t *testing.T) {
	f := installFake(t)
	empty := t.TempDir()
	t.Setenv("PATH", empty)
	withInstallDirs(t, filepath.Join(t.TempDir(), "missing"), f.dir)
	if got, err := web.Platform(t.Context()); err != nil || got != "linux/arm64" {
		t.Fatalf("Platform = %q, %v", got, err)
	}
	cmd, err := web.Exec(t.Context(), []string{"/tmp/.zero/zero"}, nil)
	if err != nil || cmd.Path != filepath.Join(f.dir, "docker") {
		t.Fatalf("Exec = %+v, %v", cmd, err)
	}
	if want := "PATH=" + f.dir + string(os.PathListSeparator) + empty; !slices.Contains(cmd.Env, want) {
		t.Fatalf("Env lacks %q", want)
	}
}

func TestWithoutDockerEveryStepSaysSo(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	withInstallDirs(t)
	if _, err := web.Platform(t.Context()); !errors.Is(err, ErrNoDocker) {
		t.Fatalf("Platform = %v", err)
	}
	if _, err := web.Install(t.Context(), "1.2.3"); !errors.Is(err, ErrNoDocker) {
		t.Fatalf("Install = %v", err)
	}
	if _, err := web.Exec(t.Context(), []string{"/tmp/.zero/zero"}, nil); !errors.Is(err, ErrNoDocker) {
		t.Fatalf("Exec = %v", err)
	}
}

func TestInstallCopiesZeroFromItsImageForThePlatform(t *testing.T) {
	f := installFake(t)
	got, err := web.Install(t.Context(), "1.2.3")
	if err != nil || got != "/tmp/.zero/zero" {
		t.Fatalf("Install = %q, %v", got, err)
	}
	calls := f.calls(t)
	if len(calls) != 6 {
		t.Fatalf("calls = %q", calls)
	}
	if calls[2] != "create --platform linux/arm64 ghcr.io/flexdinesh/zero:1.2.3" {
		t.Fatalf("create = %q", calls[2])
	}
	if !strings.HasPrefix(calls[3], "cp created123:/zero ") || !strings.HasSuffix(calls[3], "/zero") {
		t.Fatalf("copy out = %q", calls[3])
	}
	stage := strings.TrimSuffix(strings.TrimPrefix(calls[3], "cp created123:/zero "), "zero")
	if want := "cp --archive " + stage + ". web:/tmp/.zero"; calls[4] != want {
		t.Fatalf("copy in = %q, want %q", calls[4], want)
	}
	if calls[5] != "rm --force created123" {
		t.Fatalf("last call = %q, want the created container removed", calls[5])
	}
	copied, err := os.ReadFile(filepath.Join(f.root, "zero"))
	if err != nil || string(copied) != "zero binary" {
		t.Fatalf("container got %q, %v", copied, err)
	}
	if _, err := os.Stat(stage); !os.IsNotExist(err) {
		t.Fatalf("staging directory left behind: %v", err)
	}
}

func TestInstallUsesAnImageOverride(t *testing.T) {
	f := installFake(t)
	local := web
	local.Image = "zero-smoke:local"
	if _, err := local.Install(t.Context(), "1.2.3"); err != nil {
		t.Fatal(err)
	}
	if call := f.calls(t)[2]; call != "create --platform linux/arm64 zero-smoke:local" {
		t.Fatalf("create = %q", call)
	}
}

func TestInstallExplainsFailures(t *testing.T) {
	tests := []struct {
		env, value, says string
		created          bool
	}{
		{"FAKE_DOCKER_PULL_ERROR", "Error response from daemon: manifest unknown", "get ghcr.io/flexdinesh/zero:1.2.3 for linux/arm64: Error response from daemon: manifest unknown", false},
		{"FAKE_DOCKER_CP_ERROR", "Error response from daemon: container rootfs is marked read-only", `container "web" has no writable /tmp; zero installs to /tmp/.zero`, true},
		{"FAKE_DOCKER_CP_ERROR", "Error response from daemon: Could not find the file /tmp in container web", `container "web" has no /tmp`, true},
		{"FAKE_DOCKER_STATE", "stopped", "is not running", false},
	}
	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			f := installFake(t)
			t.Setenv(test.env, test.value)
			_, err := web.Install(t.Context(), "1.2.3")
			if err == nil || !strings.Contains(err.Error(), test.says) {
				t.Fatalf("Install = %v, want %q", err, test.says)
			}
			removed := strings.Contains(strings.Join(f.calls(t), "\n"), "rm --force created123")
			if removed != test.created {
				t.Fatalf("removed the created container: %v, want %v", removed, test.created)
			}
		})
	}
}

func TestInstallNamesInstallDevForAMissingDevImage(t *testing.T) {
	installFake(t)
	t.Setenv("FAKE_DOCKER_PULL_ERROR", "Error response from daemon: pull access denied for zero-dev")
	_, err := web.Install(t.Context(), "0.0.0-dev.main")
	want := "get zero-dev:0.0.0-dev.main for linux/arm64: Error response from daemon: pull access denied for zero-dev; scripts/install-dev.sh builds it"
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("Install = %v, want %q", err, want)
	}
}

func TestImageRef(t *testing.T) {
	tests := map[string]string{
		"0.2.0":                         "ghcr.io/flexdinesh/zero:0.2.0",
		"12.0.31":                       "ghcr.io/flexdinesh/zero:12.0.31",
		"0.0.0-dev.feat-x":              "zero-dev:0.0.0-dev.feat-x",
		"0.0.0-dev.g1a2b3c4d5e6f":       "zero-dev:0.0.0-dev.g1a2b3c4d5e6f",
		"dev":                           "zero-dev:dev",
		"0.2.1-0.20261111000000-abcdef": "zero-dev:0.2.1-0.20261111000000-abcdef",
		"v0.2.0":                        "zero-dev:v0.2.0",
		"0.0.0+build":                   "zero-dev:dev",
	}
	for version, want := range tests {
		if got := ImageRef(version); got != want {
			t.Errorf("ImageRef(%q) = %q, want %q", version, got, want)
		}
	}
}

func TestExecRunsArgvInTheContainerWithoutATerminal(t *testing.T) {
	f := installFake(t)
	cmd, err := web.Exec(t.Context(), []string{"/tmp/.zero/zero", "serve-stdio", "--", "/src"}, []string{"HOME=/tmp/.zero"})
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Path != filepath.Join(f.dir, "docker") {
		t.Fatalf("Path = %q", cmd.Path)
	}
	want := cmd.Path + " exec --interactive --env HOME=/tmp/.zero web /tmp/.zero/zero serve-stdio -- /src"
	if got := strings.Join(cmd.Args, " "); got != want {
		t.Fatalf("Args = %q, want %q", got, want)
	}
}

func TestNew(t *testing.T) {
	if got, err := New("web-1", "/tmp/.zero"); err != nil || got != (Container{Name: "web-1", Dir: "/tmp/.zero"}) {
		t.Fatalf("New = %+v, %v", got, err)
	}
	for _, name := range []string{"", "-it", "a/b", "a b", "a:b"} {
		if _, err := New(name, "/tmp/.zero"); err == nil {
			t.Errorf("New(%q) accepted", name)
		}
	}
}
