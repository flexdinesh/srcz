// Package docker attaches zero to a running Docker container through the
// docker CLI, so Docker contexts and DOCKER_HOST apply (decision 0127). It
// needs no shell or tools in the container: zero comes out of zero's image
// and goes in with `docker cp`.
package docker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Image is zero's image; its tags are release versions and edge.
const Image = "ghcr.io/flexdinesh/zero"

// imageBinary is zero's path in Image.
const imageBinary = "/zero"

// ErrNoDocker reports a host without the docker CLI.
var ErrNoDocker = errors.New("docker is not installed or not on PATH")

var (
	// Docker's container names, and IDs.
	nameRule = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)
	// A release version; anything else is a development build.
	releaseRule = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
)

// Container is a running container, by name or ID.
type Container struct {
	Name string
	// Dir is where Install puts zero.
	Dir string
	// Image is where Install gets zero; "" is ImageRef of its version. Tests
	// set a locally built one.
	Image string
}

// New names a container. dir is where zero goes in it.
func New(name, dir string) (Container, error) {
	if name == "" {
		return Container{}, errors.New("name a container: docker://<container>[/path]")
	}
	if !nameRule.MatchString(name) {
		return Container{}, fmt.Errorf("%q is not a Docker container name or ID", name)
	}
	return Container{Name: name, Dir: dir}, nil
}

// ImageRef is zero's image for version: its own tag for a release, edge for
// any other build.
func ImageRef(version string) string {
	if releaseRule.MatchString(version) {
		return Image + ":" + version
	}
	return Image + ":edge"
}

// Platform implements sandbox.Environment: the platform of the container's
// image. It fails when the container is missing or stopped.
func (c Container) Platform(ctx context.Context) (string, error) {
	state, err := run(ctx, "inspect", "--type", "container", "--format", "{{.State.Running}} {{.Image}}", c.Name)
	if err != nil {
		if strings.Contains(err.Error(), "No such container") {
			return "", fmt.Errorf("no container %q: `docker ps` lists the running ones", c.Name)
		}
		return "", err
	}
	running, image, _ := strings.Cut(state, " ")
	if running != "true" {
		return "", fmt.Errorf("container %q is not running: start it first", c.Name)
	}
	platform, err := run(ctx, "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image)
	if err != nil {
		return "", err
	}
	return platform, nil
}

// Install implements sandbox.Environment. It copies zero for the
// container's platform out of the image, then into Dir, owned by the
// container's user.
func (c Container) Install(ctx context.Context, version string) (string, error) {
	platform, err := c.Platform(ctx)
	if err != nil {
		return "", err
	}
	image := c.Image
	if image == "" {
		image = ImageRef(version)
	}
	scratch, err := os.MkdirTemp("", "zero-attach-")
	if err != nil {
		return "", err
	}
	defer func() { _ = os.RemoveAll(scratch) }()
	stage := filepath.Join(scratch, "stage")
	if err := os.Mkdir(stage, 0o700); err != nil {
		return "", err
	}

	// Creating a container pulls the image when needed, and runs nothing.
	created, err := run(ctx, "create", "--platform", platform, image)
	if err != nil {
		return "", fmt.Errorf("get %s for %s: %w", image, platform, err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = run(cleanup, "rm", "--force", created)
	}()
	binary := filepath.Join(stage, "zero")
	if _, err := run(ctx, "cp", created+":"+imageBinary, binary); err != nil {
		return "", fmt.Errorf("copy zero out of %s: %w", image, err)
	}
	if err := os.Chmod(binary, 0o755); err != nil {
		return "", err
	}

	// -a gives the files to the container's user, who runs zero and owns its
	// HOME there; `<dir>/.` copies the contents and creates Dir when missing.
	if _, err := run(ctx, "cp", "--archive", stage+string(filepath.Separator)+".", c.Name+":"+c.Dir); err != nil {
		message := err.Error()
		switch {
		case strings.Contains(message, "read-only"):
			return "", fmt.Errorf("container %q has no writable /tmp; zero installs to %s", c.Name, c.Dir)
		case strings.Contains(message, "Could not find the file"), strings.Contains(message, "no such file or directory"):
			return "", fmt.Errorf("container %q has no /tmp; zero installs to %s", c.Name, c.Dir)
		}
		return "", fmt.Errorf("copy zero into container %q: %w", c.Name, err)
	}
	return path.Join(c.Dir, "zero"), nil
}

// Exec implements sandbox.Environment with `docker exec -i`: no terminal, so
// the bytes pass unchanged, and the end of input reaches argv.
func (c Container) Exec(_ context.Context, argv, env []string) (*exec.Cmd, error) {
	docker, err := exec.LookPath("docker")
	if err != nil {
		return nil, ErrNoDocker
	}
	args := []string{"exec", "--interactive"}
	for _, value := range env {
		args = append(args, "--env", value)
	}
	args = append(args, c.Name)
	args = append(args, argv...)
	return exec.Command(docker, args...), nil
}

// run runs the docker CLI and returns its trimmed output, or an error with
// what it said.
func run(ctx context.Context, args ...string) (string, error) {
	docker, err := exec.LookPath("docker")
	if err != nil {
		return "", ErrNoDocker
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, docker, args...)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if said := lastLine(stderr.String()); said != "" {
			return "", errors.New(said)
		}
		return "", fmt.Errorf("docker %s: %w", args[0], err)
	}
	return strings.TrimSpace(stdout.String()), nil
}

// lastLine is the last line with text: docker prints pull progress before an
// error.
func lastLine(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}
