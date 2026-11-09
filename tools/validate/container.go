//go:build linux || darwin

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const (
	repoName      = "srcz"
	imageRepo     = repoName + "-check"
	projectPrefix = repoName + "-check-s"
	goBuildVolume = repoName + "-check-go-build"
	composeLabel  = "com.docker.compose.project"
)

// docker runs the host Docker CLI. Tests substitute a recorder. Run streams
// output (and keeps owned descriptors open in the child); output returns it.
type docker interface {
	run(ctx context.Context, env []string, out io.Writer, files []*os.File, args ...string) error
	output(ctx context.Context, args ...string) (string, error)
}

type dockerCLI struct{}

func (dockerCLI) run(ctx context.Context, env []string, out io.Writer, files []*os.File, args ...string) error {
	return commandWithFiles(ctx, "/", append(dockerEnvironment(), env...), out, files, "docker", args...)
}

func (dockerCLI) output(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Env = dockerEnvironment()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// dockerEnvironment reaches the user's daemon and CLI plugins. Containers see
// none of it: compose.yaml names every variable they receive.
func dockerEnvironment() []string {
	env := []string{"NO_COLOR=1", "BUILDKIT_PROGRESS=plain", "DOCKER_BUILDKIT=1", "COMPOSE_MENU=false", "COMPOSE_ANSI=never"}
	for _, key := range []string{"PATH", "HOME", "USER", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "XDG_RUNTIME_DIR"} {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func projectName(slot int, group string) string {
	return fmt.Sprintf("%s%d-%s", projectPrefix, slot, group)
}

func imageTag(slot int, target string) string {
	return fmt.Sprintf("%s:s%d-%s", imageRepo, slot, target)
}

func containerTask(group, task string) string {
	if task == "" {
		return "_container:" + group
	}
	return "_container:" + strings.TrimPrefix(task, "_container:")
}

// containerJob is one group's build, run, export, and teardown.
type containerJob struct {
	Docker   docker
	Slot     int
	Group    string
	Task     string
	Args     []string
	Force    bool
	Attempt  string
	Contexts string // directory holding one subdirectory per named context
	Out      string // group artifact directory
	Files    []*os.File
}

func (j containerJob) target() string { return groupTargets[j.Group] }

// build creates the group's target image from the snapshot's Dockerfile and
// returns its ID; the slot tag is for people and the sweep only.
func (j containerJob) build(ctx context.Context) (string, error) {
	target := j.target()
	log, err := os.Create(filepath.Join(j.Out, "build.log"))
	if err != nil {
		return "", err
	}
	defer log.Close()
	empty := filepath.Join(j.Contexts, "empty")
	if err := os.MkdirAll(empty, 0700); err != nil {
		return "", err
	}
	idFile := filepath.Join(j.Out, "image.id")
	args := []string{"buildx", "build", "--builder", "default", "--progress=plain", "--platform", "linux/amd64",
		"--file", filepath.Join(j.Contexts, "ctx-src", "tools", "validate", "Dockerfile"),
		"--target", target, "--tag", imageTag(j.Slot, target), "--iidfile", idFile, "--load"}
	names := append([]string{}, targetContexts[target]...)
	sort.Strings(names)
	for _, name := range names {
		args = append(args, "--build-context", name+"="+filepath.Join(j.Contexts, name))
	}
	if j.Force {
		args = append(args, "--no-cache-filter", strings.Join(forceRebuildStages(target), ","))
	}
	args = append(args, empty)
	if err := j.Docker.run(ctx, nil, log, j.Files, args...); err != nil {
		return "", fmt.Errorf("build %s image: %w; log: %s", target, err, log.Name())
	}
	raw, err := os.ReadFile(idFile)
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(id, "sha256:") {
		return "", fmt.Errorf("invalid image id %q", id)
	}
	return id, nil
}

func (j containerJob) composeEnvironment(image string) []string {
	env := []string{"SRCZ_CHECK_IMAGE=" + image, "SRCZ_VALIDATION_ATTEMPT=" + j.Attempt, fmt.Sprintf("SRCZ_VALIDATION_FORCE=%t", j.Force)}
	switch j.Group {
	case "browser-extended":
		env = append(env, "SRCZ_BROWSER_EXTENDED=1")
	case "desktop-extended":
		env = append(env, "SRCZ_DESKTOP_EXTENDED=1")
	}
	return env
}

func (j containerJob) composeArgs(args ...string) []string {
	dir := filepath.Join(j.Contexts, "ctx-src", "tools", "validate")
	return append([]string{"compose", "--project-name", projectName(j.Slot, j.Group), "--project-directory", dir, "--file", filepath.Join(dir, "compose.yaml")}, args...)
}

// execute runs the check, copies /out, and always tears the project down,
// including after failure and cancellation.
func (j containerJob) execute(ctx context.Context, image string) (err error) {
	project := projectName(j.Slot, j.Group)
	container := project + "-runner"
	defer func() {
		if cleanupErr := j.teardown(context.WithoutCancel(ctx)); cleanupErr != nil {
			err = errors.Join(err, cleanupErr)
		}
	}()
	if _, err = j.Docker.output(ctx, "volume", "create", "--label", "io.srcz.validation=cache", goBuildVolume); err != nil {
		return err
	}
	log, err := os.Create(filepath.Join(j.Out, "check.log"))
	if err != nil {
		return err
	}
	defer log.Close()
	argv := j.composeArgs("run", "--no-TTY", "--name", container, "--quiet-pull", "runner", "mise", "run", "--force", "--skip-deps", containerTask(j.Group, j.Task))
	argv = append(argv, j.Args...)
	runErr := j.Docker.run(ctx, j.composeEnvironment(image), log, j.Files, argv...)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	// The capture always exits 0 after writing status.json; a nonzero exit
	// here means compose or the container failed. Export whatever exists.
	output := filepath.Join(j.Out, "output")
	if _, cpErr := j.Docker.output(context.WithoutCancel(ctx), "cp", container+":/out", output); cpErr != nil {
		return errors.Join(runErr, cpErr)
	}
	if runErr != nil {
		return fmt.Errorf("compose run %s: %w; log: %s", project, runErr, log.Name())
	}
	return nil
}

func (j containerJob) teardown(ctx context.Context) error {
	project := projectName(j.Slot, j.Group)
	var errs []error
	if err := removeProjectContainers(ctx, j.Docker, project); err != nil {
		errs = append(errs, err)
	}
	if err := j.Docker.run(ctx, j.composeEnvironment("sha256:none"), io.Discard, nil, j.composeArgs("down", "--volumes", "--remove-orphans", "--timeout", "5")...); err != nil {
		errs = append(errs, fmt.Errorf("compose down %s: %w", project, err))
	}
	return errors.Join(errs...)
}

func removeProjectContainers(ctx context.Context, d docker, project string) error {
	ids, err := d.output(ctx, "ps", "--all", "--quiet", "--filter", "label="+composeLabel+"="+project)
	if err != nil {
		return err
	}
	if fields := strings.Fields(ids); len(fields) > 0 {
		if _, err := d.output(ctx, append([]string{"rm", "--force", "--volumes"}, fields...)...); err != nil {
			return err
		}
	}
	return nil
}

// sweepSlot removes what an interrupted run in this slot left behind: its
// projects' containers and networks and its image tags. It runs only while
// holding the slot lock, and never touches other slots or repositories.
func sweepSlot(ctx context.Context, d docker, slot int) error {
	prefix := fmt.Sprintf("%s%d-", projectPrefix, slot)
	var errs []error
	projects := map[string]bool{}
	for _, kind := range [][]string{{"ps", "--all"}, {"network", "ls"}} {
		out, err := d.output(ctx, append(kind, "--filter", "label="+composeLabel, "--format", `{{.Label "`+composeLabel+`"}}`)...)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for _, name := range strings.Fields(out) {
			if strings.HasPrefix(name, prefix) {
				projects[name] = true
			}
		}
	}
	names := make([]string, 0, len(projects))
	for name := range projects {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, project := range names {
		if err := removeProjectContainers(ctx, d, project); err != nil {
			errs = append(errs, err)
		}
		networks, err := d.output(ctx, "network", "ls", "--quiet", "--filter", "label="+composeLabel+"="+project)
		if err != nil {
			errs = append(errs, err)
		} else if ids := strings.Fields(networks); len(ids) > 0 {
			if _, err := d.output(ctx, append([]string{"network", "rm"}, ids...)...); err != nil {
				errs = append(errs, err)
			}
		}
	}
	if err := untagSlot(ctx, d, slot); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

// untagSlot removes this slot's tags. Images other tags or containers still
// reference survive; build cache is untouched.
func untagSlot(ctx context.Context, d docker, slot int) error {
	out, err := d.output(ctx, "image", "ls", imageRepo, "--format", "{{.Tag}}")
	if err != nil {
		return err
	}
	var tags []string
	for _, tag := range strings.Fields(out) {
		if strings.HasPrefix(tag, fmt.Sprintf("s%d-", slot)) {
			tags = append(tags, imageRepo+":"+tag)
		}
	}
	sort.Strings(tags)
	if len(tags) == 0 {
		return nil
	}
	_, err = d.output(ctx, append([]string{"image", "rm"}, tags...)...)
	return err
}
