//go:build darwin || linux

package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/flexdinesh/zero/internal/tailscale"
	"github.com/flexdinesh/zero/pkg/contract"
)

const (
	tailnetName      = "box.tail1234.ts.net"
	tailnetRunning   = `{"BackendState":"Running","Self":{"DNSName":"box.tail1234.ts.net."},"CertDomains":["box.tail1234.ts.net"]}`
	tailnetLoggedOut = `{"BackendState":"NeedsLogin","Self":{"DNSName":""},"CertDomains":null}`
	tailnetNoHTTPS   = `{"BackendState":"Running","Self":{"DNSName":"box.tail1234.ts.net."},"CertDomains":null}`
)

// fakeTailscale is a tailscale CLI on PATH: status prints status.json, and
// serve records its arguments and process ID, then serves until stopped.
type fakeTailscale struct{ directory string }

func newFakeTailscale(t *testing.T, status string) fakeTailscale {
	t.Helper()
	fake := fakeTailscale{directory: t.TempDir()}
	script := `#!/bin/sh
directory=$(dirname "$0")
case "$1" in
status) cat "$directory/status.json" ;;
serve)
	echo "$@" > "$directory/serve.args"
	echo $$ > "$directory/serve.pid"
	echo 'Available within your tailnet:'
	exec sleep 600 ;;
esac
`
	if err := os.WriteFile(filepath.Join(fake.directory, "tailscale"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fake.directory, "status.json"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fake.directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	return fake
}

// target is the address serve proxies to.
func (f fakeTailscale) target(t *testing.T) string {
	t.Helper()
	arguments, err := os.ReadFile(filepath.Join(f.directory, "serve.args"))
	if err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields(string(arguments))
	if len(fields) != 3 || fields[0] != "serve" || !strings.HasPrefix(fields[2], "http://127.0.0.1:") {
		t.Fatalf("serve arguments = %q", arguments)
	}
	return strings.TrimPrefix(fields[2], "http://")
}

// waitStopped waits for the serve process to be gone.
func (f fakeTailscale) waitStopped(t *testing.T) {
	t.Helper()
	text, err := os.ReadFile(filepath.Join(f.directory, "serve.pid"))
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(text)))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for syscall.Kill(pid, 0) == nil {
		if time.Now().After(deadline) {
			t.Fatal("tailscale serve still runs")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func tailscaleDaemon(t *testing.T, idleExit time.Duration, status string) (*testDaemon, fakeTailscale) {
	t.Helper()
	fake := newFakeTailscale(t, status)
	config := daemonConfig(t)
	config.Lifetime = Lifetime{IdleExit: idleExit, FirstWait: DefaultRemoteFirstWait, Grace: DefaultRemoteGrace}
	config.IdentityFile = filepath.Join(t.TempDir(), "remote", "identity.json")
	config.Tailscale = &tailscale.Client{}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Tailnet\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	daemon := startDaemon(t, config)
	if _, err := daemon.client.Open(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	return daemon, fake
}

func startTailscale(t *testing.T, daemon *testDaemon, firstWait, grace string) contract.DaemonRemote {
	t.Helper()
	status, err := daemon.client.RemoteStart(context.Background(), contract.DaemonRemoteRequest{Exposure: contract.RemoteExposureTailscale, FirstWait: firstWait, Grace: grace})
	if err != nil {
		t.Fatal(err)
	}
	return status
}

// get requests path from target as Tailscale delivers it, with host.
func get(t *testing.T, target, host, path string) (int, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, "http://"+target+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = host
	response, err := http.DefaultTransport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, body
}

func TestTailscaleServesTheAppToTheMachinesNameOnly(t *testing.T) {
	daemon, fake := tailscaleDaemon(t, time.Hour, tailnetRunning)
	status := startTailscale(t, daemon, "", "")
	want := contract.DaemonRemote{Listening: true, Exposure: contract.RemoteExposureTailscale, Host: tailnetName, Port: DefaultTailscalePort}
	if status != want {
		t.Fatalf("status = %+v, want %+v", status, want)
	}
	if again, err := daemon.client.RemoteStatus(context.Background()); err != nil || again != want {
		t.Errorf("RemoteStatus() = %+v, %v", again, err)
	}
	target := fake.target(t)
	if host, _, err := net.SplitHostPort(target); err != nil || host != "127.0.0.1" {
		t.Errorf("serve target = %s, want loopback", target)
	}
	name := tailnetName + ":7971"
	if code, _ := get(t, target, name, "/api/projects"); code != http.StatusOK {
		t.Errorf("/api/projects for %s = %d", name, code)
	}
	code, body := get(t, target, name, contract.RemoteInfoPath)
	var info contract.RemoteInfo
	if code != http.StatusOK || json.Unmarshal(body, &info) != nil || info.Protocol != ProtocolVersion || info.Name == "" {
		t.Errorf("%s = %d %s, want RemoteInfo without a token", contract.RemoteInfoPath, code, body)
	}
	for _, host := range []string{"attacker.example:7971", "other.tail1234.ts.net:7971"} {
		for _, path := range []string{"/api/projects", contract.RemoteInfoPath} {
			if code, _ := get(t, target, host, path); code != http.StatusForbidden {
				t.Errorf("%s for %s = %d, want refused", path, host, code)
			}
		}
	}
	for _, path := range []string{"/_daemon/status", "/_daemon/remote", "/_daemon/stop"} {
		if code, _ := get(t, target, name, path); code == http.StatusOK || code == http.StatusAccepted {
			t.Errorf("%s over the tailnet = %d, want it unreachable", path, code)
		}
	}

	if err := daemon.client.RemoteStop(context.Background()); err != nil {
		t.Fatal(err)
	}
	fake.waitStopped(t)
	if err := daemon.wait(t); err != nil {
		t.Errorf("Run() = %v", err)
	}
}

func TestTailscaleErrorsNameTheirFix(t *testing.T) {
	for _, test := range []struct {
		name, status, fix string
	}{
		{"logged out", tailnetLoggedOut, "tailscale up"},
		{"no HTTPS", tailnetNoHTTPS, "HTTPS Certificates"},
	} {
		daemon, fake := tailscaleDaemon(t, 0, test.status)
		var failure *ControlError
		_, err := daemon.client.RemoteStart(context.Background(), contract.DaemonRemoteRequest{Exposure: contract.RemoteExposureTailscale})
		if !errors.As(err, &failure) || failure.Code != contract.CodeTailscaleUnavailable || !strings.Contains(failure.Message, test.fix) {
			t.Errorf("%s: RemoteStart() = %v", test.name, err)
		}
		if _, err := os.Stat(filepath.Join(fake.directory, "serve.args")); err == nil {
			t.Errorf("%s: serve ran", test.name)
		}
		if status, err := daemon.client.RemoteStatus(context.Background()); err != nil || status.Listening {
			t.Errorf("%s: status = %+v, %v", test.name, status, err)
		}
	}
	daemon, _ := tailscaleDaemon(t, 0, tailnetRunning)
	t.Setenv("PATH", t.TempDir())
	var failure *ControlError
	if _, err := daemon.client.RemoteStart(context.Background(), contract.DaemonRemoteRequest{Exposure: contract.RemoteExposureTailscale}); !errors.As(err, &failure) || !strings.Contains(failure.Message, "tailscale.com/download") {
		t.Errorf("not installed: %v", err)
	}
	for name, request := range map[string]contract.DaemonRemoteRequest{
		"host":     {Exposure: contract.RemoteExposureTailscale, Host: "127.0.0.1"},
		"port":     {Exposure: contract.RemoteExposureTailscale, Port: new(int)},
		"exposure": {Exposure: "funnel"},
	} {
		if _, err := daemon.client.RemoteStart(context.Background(), request); !errors.As(err, &failure) || failure.Status != http.StatusBadRequest {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestTailscaleExitsWhenNothingEverConnects(t *testing.T) {
	daemon, fake := tailscaleDaemon(t, time.Hour, tailnetRunning)
	startTailscale(t, daemon, "100ms", "1h")
	if err := daemon.wait(t); err != nil {
		t.Errorf("Run() = %v", err)
	}
	fake.waitStopped(t)
	if !strings.Contains(daemon.log.String(), "no UI connected") {
		t.Errorf("log = %s", daemon.log)
	}
}

func TestTailscaleExitsAfterTheLastUI(t *testing.T) {
	daemon, fake := tailscaleDaemon(t, time.Hour, tailnetRunning)
	startTailscale(t, daemon, "1h", "100ms")
	release := holdPresence(t, http.DefaultTransport, "http://"+fake.target(t))
	waitForClients(t, daemon, 1)
	time.Sleep(400 * time.Millisecond)
	if status, err := daemon.client.RemoteStatus(context.Background()); err != nil || !status.Listening {
		t.Fatalf("status with a UI connected = %+v, %v", status, err)
	}
	release()
	if err := daemon.wait(t); err != nil {
		t.Errorf("Run() = %v", err)
	}
	fake.waitStopped(t)
}

func TestStartingOneExposureStopsTheOther(t *testing.T) {
	daemon, fake := tailscaleDaemon(t, time.Hour, tailnetRunning)
	tls, _ := startRemote(t, daemon, "", "")
	if tls.Exposure != contract.RemoteExposureTLS {
		t.Errorf("TLS status = %+v", tls)
	}
	if status := startTailscale(t, daemon, "", ""); status.Exposure != contract.RemoteExposureTailscale {
		t.Fatalf("status = %+v", status)
	}
	if conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(tls.Port)), time.Second); err == nil {
		_ = conn.Close()
		t.Error("the TLS port still accepts")
	}
	// The closed TLS listener does not take the daemon with it.
	time.Sleep(remoteSettle + 200*time.Millisecond)
	if status, err := daemon.client.RemoteStatus(context.Background()); err != nil || status.Exposure != contract.RemoteExposureTailscale {
		t.Fatalf("status = %+v, %v", status, err)
	}
	startRemote(t, daemon, "", "")
	fake.waitStopped(t)
	time.Sleep(remoteSettle + 200*time.Millisecond)
	if status, err := daemon.client.RemoteStatus(context.Background()); err != nil || status.Exposure != contract.RemoteExposureTLS {
		t.Errorf("status = %+v, %v", status, err)
	}
}
