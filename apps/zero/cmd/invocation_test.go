//go:build darwin || linux

package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/flexdinesh/zero/internal/daemon"
	"github.com/flexdinesh/zero/pkg/connection"
	"github.com/flexdinesh/zero/pkg/contract"
)

// installedCLI executes the real entry point through an alternate filename.
func installedCLI(t *testing.T, name string) func([]string, ...string) cliResult {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	installed := filepath.Join(t.TempDir(), name)
	if err := os.Symlink(executable, installed); err != nil {
		t.Fatal(err)
	}
	return func(env []string, args ...string) cliResult {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, installed, args...)
		command.Env = append(os.Environ(), "ZERO_CMD_TEST_EXEC=1")
		command.Env = append(command.Env, env...)
		var stdout, stderr bytes.Buffer
		command.Stdout, command.Stderr = &stdout, &stderr
		err := command.Run()
		return cliResult{stdout: stdout.String(), stderr: stderr.String(), err: err}
	}
}

func TestInstalledNameHelpAndVersion(t *testing.T) {
	for _, name := range []string{"zero", "zero-cli", "my-zero"} {
		t.Run(name, func(t *testing.T) {
			invoke := installedCLI(t, name)
			for _, test := range []struct {
				args []string
				want string
			}{
				{[]string{"--help"}, name + " [path] [flags]"},
				{[]string{"help", "browser"}, name + " browser [path] [flags]"},
				{[]string{"connect", "--help"}, name + " connect <string> [flags]"},
				{[]string{"remote", "status", "--help"}, name + " remote status [flags]"},
				{[]string{"walkthrough", "publish", "--help"}, name + " walkthrough publish <file|-> [flags]"},
				{[]string{"daemon", "status", "--help"}, name + " daemon status [flags]"},
				{[]string{"--version"}, "zero dev\n"},
			} {
				result := invoke(nil, test.args...)
				if result.err != nil || !strings.Contains(result.stdout, test.want) || result.stderr != "" {
					t.Errorf("%s %v = %+v; want %q", name, test.args, result, test.want)
				}
			}
			result := invoke(nil, "--help")
			if !strings.Contains(result.stdout, "started by "+name+" --remote") {
				t.Errorf("help = %q; want selected-name remote hint", result.stdout)
			}
			result = invoke([]string{"SSH_CONNECTION=" + testSSHConnection}, ".")
			if result.err == nil || !strings.Contains(result.stderr, "run `"+name+" <path> --remote`") || result.stdout != "" {
				t.Errorf("no UI = %+v", result)
			}
		})
	}
}

func TestAlternateNameDaemonLaunch(t *testing.T) {
	invoke := installedCLI(t, "zero-cli")
	dir, err := os.MkdirTemp("", "zero-cli")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "daemon.sock")
	config := t.TempDir()
	env := []string{"HOME=" + config, "XDG_CONFIG_HOME=" + config, "XDG_CACHE_HOME=" + t.TempDir()}
	t.Cleanup(func() { invoke(env, "daemon", "stop", "--socket", socket) })
	result := invoke(env, "daemon", "ensure", "--json", "--socket", socket, "--idle-exit", "2m")
	if result.err != nil {
		t.Fatalf("ensure = %+v", result)
	}
	var status daemon.Status
	if err := json.Unmarshal([]byte(result.stdout), &status); err != nil {
		t.Fatal(err)
	}
	if status.Protocol != daemon.ProtocolVersion || status.PID == os.Getpid() {
		t.Fatalf("status = %+v", status)
	}
	if _, err := daemon.NewClient(socket).Open(context.Background(), t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "darwin" {
		config = filepath.Join(config, "Library", "Application Support")
	}
	if _, err := os.Stat(filepath.Join(config, "zero", "roots.json")); err != nil {
		t.Errorf("canonical config directory missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(config, "zero-cli")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("invocation changed config identity: %v", err)
	}
	result = invoke(env, "daemon", "stop", "--socket", socket)
	if result.err != nil || result.stdout != "stopped\n" {
		t.Fatalf("stop = %+v", result)
	}
}

func TestAlternateNameAppHints(t *testing.T) {
	root := appRoot(t)
	for _, name := range []cliName{"zero-cli", "my-zero"} {
		t.Run(name.String(), func(t *testing.T) {
			opts := appOptions(root)
			opts.cliName = name
			_, deps := newAppFake()
			deps.ensure = func(context.Context, daemonOptions) (daemon.Status, bool, error) {
				return daemon.Status{Depth: 2, ScanDepth: 2}, false, nil
			}
			stdout, stderr, err := runAppWith(opts, deps)
			if err != nil || !strings.Contains(stderr, "`"+name.String()+" daemon stop`") || !strings.Contains(stdout, "zero://local/") {
				t.Fatalf("app = %q, %q, %v", stdout, stderr, err)
			}
			deps.installed = func(context.Context) (bool, error) { return false, nil }
			_, stderr, err = runAppWith(opts, deps)
			for _, want := range []string{"`" + name.String() + " browser`", "| sh -s -- --name " + name.String(), "zero-desktop_", "zero://"} {
				if err != nil || !strings.Contains(stderr, want) {
					t.Errorf("fallback = %q, %v; want %q", stderr, err, want)
				}
			}
			deps.getenv = sshEnv
			_, _, err = runAppWith(opts, deps)
			if !errors.Is(err, errNoUI) || !strings.Contains(err.Error(), "`"+name.String()+" <path> --remote`") {
				t.Errorf("no UI = %v", err)
			}
		})
	}
}

func TestAlternateNamePreservesDaemonErrors(t *testing.T) {
	name := cliName("zero-cli")
	mismatch := &daemon.ProtocolMismatchError{Daemon: 2, Client: 1, Socket: "/tmp/zero.sock", DaemonVersion: "1.0"}
	err := name.explainError(mismatch)
	var got *daemon.ProtocolMismatchError
	if !errors.As(err, &got) || got != mismatch || !strings.Contains(err.Error(), "`zero-cli daemon stop`") {
		t.Errorf("mismatch = %v", err)
	}
	err = name.explainError(remoteFailure(&daemon.ControlError{Status: 404}))
	if !strings.Contains(err.Error(), "`zero-cli daemon stop`") {
		t.Errorf("remote failure = %v", err)
	}
}

func TestAlternateNameRemoteStartupAndConnectHints(t *testing.T) {
	disableColor(t)
	var stdout bytes.Buffer
	writeRemoteStartup(&stdout, remoteStartup{CLIName: "my-zero", Version: "zero dev", Connect: "<string>"})
	for _, want := range []string{"zero dev", "zero connect <string>", "substitute that name for zero", "`my-zero remote stop`"} {
		if !strings.Contains(stdout.String(), want) {
			t.Errorf("remote startup = %q; want %q", stdout.String(), want)
		}
	}
	_, deps := newConnectFake(t)
	deps.probe = func(context.Context, connection.TLS) (connection.TLS, contract.RemoteInfo, error) {
		return connection.TLS{}, contract.RemoteInfo{}, connection.ErrUnreachable
	}
	err := runConnect(context.Background(), connectOptions{cliName: "my-zero", text: validConnectText(t)}, io.Discard, io.Discard, deps)
	for _, want := range []string{"my-zero connect <string> --host localhost", "`zero remote status` on the server", "another command name on the server"} {
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("connect = %v; want %q", err, want)
		}
	}
}

func TestAlternateNameWalkthroughPublishHint(t *testing.T) {
	root, hash := publishRepo(t)
	draft := tourDraft(root, hash)
	opts, _ := testPublishOptions(t, "-")
	opts.cliName = "my-zero"
	for _, open := range []bool{false, true} {
		draft.Open = open
		stdout, stderr, err := runPublish(t, opts, publishDraft(t, draft))
		if err != nil || stderr != "" || !strings.Contains(stdout, "run: my-zero "+root+", then open Walkthroughs") {
			t.Errorf("publish (open %v) = %q, %q, %v", open, stdout, stderr, err)
		}
	}
	invoke := installedCLI(t, "my-zero")
	source := filepath.Join(t.TempDir(), "tour.json")
	writePublishFile(t, source, publishDraft(t, draft))
	runtimeDir, err := os.MkdirTemp("", "zero-wt")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(runtimeDir) })
	result := invoke([]string{
		"HOME=" + t.TempDir(),
		"XDG_CONFIG_HOME=" + t.TempDir(),
		"XDG_CACHE_HOME=" + t.TempDir(),
		"XDG_RUNTIME_DIR=" + runtimeDir,
		"SSH_CONNECTION=" + testSSHConnection,
	}, "walkthrough", "publish", source, "--no-open")
	if result.err != nil || !strings.Contains(result.stdout, "run: my-zero "+root+", then open Walkthroughs") {
		t.Errorf("installed publish = %+v", result)
	}
}
