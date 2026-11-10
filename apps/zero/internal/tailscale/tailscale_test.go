package tailscale

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Status answers as `tailscale status --json` does, trimmed to what is read.
const (
	runningStatus   = `{"BackendState":"Running","Self":{"DNSName":"box.tail1234.ts.net.","HostName":"box"},"CertDomains":["box.tail1234.ts.net"]}`
	loggedOutStatus = `{"BackendState":"NeedsLogin","Self":{"DNSName":""},"CertDomains":null}`
	noHTTPSStatus   = `{"BackendState":"Running","Self":{"DNSName":"box.tail1234.ts.net."},"CertDomains":null}`
)

// fakeCLI writes a tailscale CLI running script, which sees its arguments as
// "$@", into a fresh directory, and returns the directory.
func fakeCLI(t *testing.T, script string) string {
	t.Helper()
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "tailscale"), []byte("#!/bin/sh\n"+script), 0o700); err != nil {
		t.Fatal(err)
	}
	return directory
}

func client(t *testing.T, script string) *Client {
	t.Helper()
	return &Client{Path: filepath.Join(fakeCLI(t, script), "tailscale")}
}

func TestStatusReadsTheNameAndWhetherServingCanWork(t *testing.T) {
	for _, test := range []struct {
		name, answer string
		want         error
	}{
		{"running", runningStatus, nil},
		{"logged out", loggedOutStatus, ErrNotConnected},
		{"no HTTPS", noHTTPSStatus, ErrHTTPSDisabled},
	} {
		status, err := client(t, "echo '"+test.answer+"'\n").Status(context.Background())
		if err != nil {
			t.Fatalf("%s: Status() = %v", test.name, err)
		}
		if got := status.CanServe(); !errors.Is(got, test.want) || (test.want == nil) != (got == nil) {
			t.Errorf("%s: CanServe() = %v, want %v", test.name, got, test.want)
		}
	}
	status, err := client(t, "echo '"+runningStatus+"'\n").Status(context.Background())
	if err != nil || status.DNSName != "box.tail1234.ts.net" || status.BackendState != "Running" {
		t.Errorf("Status() = %+v, %v; want the name without its trailing dot", status, err)
	}
}

func TestStatusErrorsNameTheirFix(t *testing.T) {
	notRunning := client(t, "echo 'failed to connect to local tailscaled; it does not appear to be running' >&2\nexit 1\n")
	if _, err := notRunning.Status(context.Background()); !errors.Is(err, ErrNotRunning) || !strings.Contains(err.Error(), "failed to connect") {
		t.Errorf("not running: %v", err)
	}
	missing := &Client{Path: filepath.Join(t.TempDir(), "tailscale")}
	if _, err := missing.Status(context.Background()); !errors.Is(err, ErrNotInstalled) {
		t.Errorf("missing: %v", err)
	}
	t.Setenv("PATH", t.TempDir())
	if _, err := (&Client{}).Status(context.Background()); !errors.Is(err, ErrNotInstalled) || !strings.Contains(err.Error(), "tailscale.com/download") {
		t.Errorf("not on PATH: %v", err)
	}
}

func TestStatusFindsTheCLIOnPath(t *testing.T) {
	t.Setenv("PATH", fakeCLI(t, "echo '"+runningStatus+"'\n"))
	if status, err := (&Client{}).Status(context.Background()); err != nil || status.DNSName != "box.tail1234.ts.net" {
		t.Errorf("Status() = %+v, %v", status, err)
	}
}

func TestServeRunsInTheForegroundUntilStopped(t *testing.T) {
	directory := t.TempDir()
	arguments := filepath.Join(directory, "arguments")
	cli := client(t, `echo "$@" > `+arguments+`
echo 'Available within your tailnet:'
echo
echo 'https://box.tail1234.ts.net:7971/'
exec sleep 60
`)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serving, err := cli.Serve(ctx, 7971, "http://127.0.0.1:41234")
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(arguments)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(got)) != "serve --https=7971 http://127.0.0.1:41234" {
		t.Errorf("arguments = %q, want a foreground serve (no --bg)", got)
	}
	select {
	case <-serving.Done():
		t.Fatal("serve exited while serving")
	case <-time.After(50 * time.Millisecond):
	}
	cancel()
	select {
	case <-serving.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("serve outlived its context")
	}
	if serving.Err() != nil {
		t.Errorf("Err() after a stop = %v", serving.Err())
	}
}

func TestServeReportsAnExitWhileServing(t *testing.T) {
	cli := client(t, "echo 'Available within your tailnet:'\nsleep 0.1\necho 'lost the session' >&2\nexit 1\n")
	serving, err := cli.Serve(context.Background(), 7971, "http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	<-serving.Done()
	if serving.Err() == nil || !strings.Contains(serving.Err().Error(), "lost the session") {
		t.Errorf("Err() = %v", serving.Err())
	}
}

func TestServeErrorsNameTheirFix(t *testing.T) {
	for _, test := range []struct {
		name, script string
		want         error
		text         string
	}{
		{"operator", "echo 'Access denied: serve config denied' >&2\nexit 1\n", ErrPermission, "--operator=$USER"},
		{"https", "echo 'error enabling https feature: HTTPS is not enabled' >&2\nexit 1\n", ErrHTTPSDisabled, "admin/dns"},
		{"other", "echo 'serve: port in use' >&2\nexit 1\n", nil, "port in use"},
	} {
		_, err := client(t, test.script).Serve(context.Background(), 7971, "http://127.0.0.1:1")
		if err == nil || !strings.Contains(err.Error(), test.text) || (test.want != nil && !errors.Is(err, test.want)) {
			t.Errorf("%s: Serve() = %v", test.name, err)
		}
	}
	missing := &Client{Path: filepath.Join(t.TempDir(), "tailscale")}
	if _, err := missing.Serve(context.Background(), 7971, "http://127.0.0.1:1"); !errors.Is(err, ErrNotInstalled) {
		t.Errorf("missing: %v", err)
	}
}

func TestServeGivesUpWhenTailscaleNeverReportsServing(t *testing.T) {
	cli := client(t, "echo 'To enable HTTPS, visit: https://login.tailscale.com/f/serve'\nexec sleep 60\n")
	cli.ReadyTimeout = 100 * time.Millisecond
	started := time.Now()
	_, err := cli.Serve(context.Background(), 7971, "http://127.0.0.1:1")
	if err == nil || !strings.Contains(err.Error(), "login.tailscale.com/f/serve") {
		t.Errorf("Serve() = %v, want the output", err)
	}
	if time.Since(started) > 8*time.Second {
		t.Errorf("Serve() took %s", time.Since(started))
	}
}
