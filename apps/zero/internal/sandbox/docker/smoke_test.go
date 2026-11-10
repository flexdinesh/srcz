package docker_test

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flexdinesh/zero/internal/attach"
	"github.com/flexdinesh/zero/internal/sandbox"
	"github.com/flexdinesh/zero/internal/sandbox/docker"
	"github.com/flexdinesh/zero/pkg/contract"
)

// smokeBinary names a zero binary built for this Docker's platform. The smoke
// test runs only with it (decision 0127):
//
//	mise run build:web
//	CGO_ENABLED=0 go build -o .dev/zero-smoke ./apps/zero
//	ZERO_DOCKER_SMOKE_BINARY=$PWD/.dev/zero-smoke go test ./apps/zero/internal/sandbox/docker -run Smoke
const smokeBinary = "ZERO_DOCKER_SMOKE_BINARY"

// distrolessNonroot is the nonroot user of distroless images.
const distrolessNonroot = 65532

// TestSmokeAttachToAShellLessContainer builds a distroless image holding the
// binary, which is both where Install gets zero (Image) and the container
// zero attaches to: no shell, a nonroot user, and a /tmp.
func TestSmokeAttachToAShellLessContainer(t *testing.T) {
	binary := os.Getenv(smokeBinary)
	if binary == "" {
		t.Skip("set " + smokeBinary + " to run against Docker")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("no docker")
	}
	context := t.TempDir()
	data, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(context, "zero"), data, 0o755); err != nil {
		t.Fatal(err)
	}
	dockerfile := "FROM gcr.io/distroless/static:nonroot\nCOPY zero /zero\nENTRYPOINT [\"/zero\"]\n"
	if err := os.WriteFile(filepath.Join(context, "Dockerfile"), []byte(dockerfile), 0o600); err != nil {
		t.Fatal(err)
	}
	tag := fmt.Sprintf("zero-attach-smoke:%d", time.Now().UnixNano())
	dockerRun(t, "build", "--quiet", "--tag", tag, context)
	t.Cleanup(func() { _, _ = exec.Command("docker", "image", "rm", "--force", tag).CombinedOutput() })
	name := strings.ReplaceAll(strings.ReplaceAll(tag, ":", "-"), "_", "-")
	dockerRun(t, "run", "--detach", "--name", name, tag, "browser", "--no-open", "--host", "127.0.0.1", "/etc")
	t.Cleanup(func() { _, _ = exec.Command("docker", "rm", "--force", name).CombinedOutput() })
	if out, err := exec.Command("docker", "exec", name, "/bin/sh", "-c", "true").CombinedOutput(); err == nil {
		t.Fatalf("the container has a shell: %s", out)
	}

	container := docker.Container{Name: name, Dir: sandbox.InstallDir, Image: tag}
	endpoint, err := attach.Attach(t.Context(), container, "/etc", "0.0.0-edge")
	if err != nil {
		t.Fatal(err)
	}
	transport := endpoint.Transport()
	info, err := transport.Connect(t.Context())
	if err != nil {
		_ = transport.Close()
		t.Fatal(err)
	}
	if info.Protocol <= 0 || info.Name == "" {
		t.Fatalf("info = %+v", info)
	}
	response, err := (&http.Client{Transport: transport}).Get(endpoint.BaseURL() + "/api/projects")
	if err != nil {
		t.Fatal(err)
	}
	var projects contract.ProjectsResponse
	err = json.NewDecoder(response.Body).Decode(&projects)
	_ = response.Body.Close()
	if err != nil || len(projects.Roots) != 1 || projects.Roots[0].Path != "/etc" {
		t.Fatalf("projects = %+v, %v", projects, err)
	}
	if said := dockerRun(t, "exec", name, sandbox.InstallDir+"/zero", "--version"); !strings.HasPrefix(said, "zero ") {
		t.Fatalf("installed zero says %q", said)
	}
	// The container's user owns zero's directory, its HOME there.
	archive, err := exec.Command("docker", "cp", name+":"+sandbox.InstallDir, "-").Output()
	if err != nil {
		t.Fatal(err)
	}
	header, err := tar.NewReader(bytes.NewReader(archive)).Next()
	if err != nil || header.Uid != distrolessNonroot {
		t.Fatalf("%s is owned by %v, %v; want uid %d", sandbox.InstallDir, header, err, distrolessNonroot)
	}

	// Closing ends zero in the container, which removes its binary.
	if err := transport.Close(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		_, err := exec.Command("docker", "exec", name, sandbox.InstallDir+"/zero", "--version").CombinedOutput()
		if err != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("zero's binary is still in the container after it stopped")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func dockerRun(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}
