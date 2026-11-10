// Package tailscale runs the tailscale CLI: this machine's status and a
// foreground `tailscale serve` (decision 0126). Each error names its fix. It
// knows no web app and no daemon.
package tailscale

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	goruntime "runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// macOSApp is the CLI inside the macOS app, which puts nothing on PATH.
const macOSApp = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"

// DefaultReadyTimeout bounds how long Serve waits for Tailscale to report
// serving.
const DefaultReadyTimeout = 30 * time.Second

// stopDelay is how long a stopped serve has to exit before it is killed.
const stopDelay = 5 * time.Second

// servingMessage is what a foreground `tailscale serve` prints once its
// configuration is in place.
const servingMessage = "Available within your tailnet"

// maxOutput bounds the serve output kept for an error.
const maxOutput = 4 << 10

var (
	ErrNotInstalled = errors.New("tailscale is not installed; install it from https://tailscale.com/download")
	ErrNotRunning   = errors.New("tailscale is not running; open the Tailscale app, or run `sudo systemctl enable --now tailscaled`")
	ErrNotConnected = errors.New("tailscale is not connected; run `tailscale up`")
	// ErrHTTPSDisabled: serve needs the tailnet's HTTPS certificates, which
	// also need MagicDNS.
	ErrHTTPSDisabled = errors.New("HTTPS certificates are off for this tailnet; turn on MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns")
	// ErrPermission: on Linux, tailscaled lets only root and its operator
	// change what it serves.
	ErrPermission = errors.New("tailscale refused to serve for this user; run `sudo tailscale set --operator=$USER` once")
)

// Client runs the tailscale CLI. The zero value finds it.
type Client struct {
	// Path is the CLI; "" looks for tailscale on PATH, then in the macOS app.
	Path string
	// ReadyTimeout replaces DefaultReadyTimeout when positive.
	ReadyTimeout time.Duration
}

// Status is the part of `tailscale status --json` serving needs.
type Status struct {
	// BackendState is Running when connected; NeedsLogin, Stopped, and
	// others are not.
	BackendState string
	// DNSName is this machine's MagicDNS name without the trailing dot, such
	// as box.tail1234.ts.net.
	DNSName string
	// CertDomains are the names Tailscale issues certificates for.
	CertDomains []string
}

// CanServe reports why this machine cannot serve over HTTPS, or nil.
func (s Status) CanServe() error {
	if s.BackendState != "Running" {
		return fmt.Errorf("%w (state %s)", ErrNotConnected, s.BackendState)
	}
	if s.DNSName == "" || !slices.ContainsFunc(s.CertDomains, func(name string) bool { return strings.EqualFold(name, s.DNSName) }) {
		return ErrHTTPSDisabled
	}
	return nil
}

// Status asks tailscaled for this machine's state.
func (c *Client) Status(ctx context.Context) (Status, error) {
	path, err := c.binary()
	if err != nil {
		return Status{}, err
	}
	var stdout, stderr bytes.Buffer
	command := exec.CommandContext(ctx, path, "status", "--json")
	command.Stdout, command.Stderr = &stdout, &stderr
	runErr := command.Run()
	if notInstalled(runErr) {
		return Status{}, ErrNotInstalled
	}
	var answer struct {
		BackendState string
		Self         *struct{ DNSName string }
		CertDomains  []string
	}
	if json.Unmarshal(stdout.Bytes(), &answer) != nil || answer.BackendState == "" {
		if ctx.Err() != nil {
			return Status{}, ctx.Err()
		}
		if runErr != nil {
			return Status{}, fmt.Errorf("%w: %s", ErrNotRunning, output(stderr.String(), runErr))
		}
		return Status{}, errors.New("tailscale status --json printed no status")
	}
	status := Status{BackendState: answer.BackendState, CertDomains: answer.CertDomains}
	if answer.Self != nil {
		status.DNSName = strings.TrimSuffix(answer.Self.DNSName, ".")
	}
	return status, nil
}

// Serving is a running `tailscale serve`.
type Serving struct {
	done chan struct{}
	err  error
}

// Done closes when the serve has exited.
func (s *Serving) Done() <-chan struct{} { return s.done }

// Err is why the serve exited, once Done has closed; nil after a stop.
func (s *Serving) Err() error { return s.err }

// Serve runs `tailscale serve --https=<httpsPort> <target>` in the foreground
// until ctx ends. Tailscale forgets a foreground configuration when its CLI
// exits, so nothing outlives this process (it never passes --bg). Serve
// returns once Tailscale reports serving, or the error that stopped it.
func (c *Client) Serve(parent context.Context, httpsPort int, target string) (*Serving, error) {
	path, err := c.binary()
	if err != nil {
		return nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	command := exec.CommandContext(ctx, path, "serve", "--https="+strconv.Itoa(httpsPort), target)
	command.Stdout, command.Stderr = writer, writer
	// An interrupt lets the CLI close its session; tailscaled then drops the
	// configuration.
	command.Cancel = func() error { return command.Process.Signal(os.Interrupt) }
	command.WaitDelay = stopDelay
	err = command.Start()
	_ = writer.Close()
	if err != nil {
		cancel()
		_ = reader.Close()
		if notInstalled(err) {
			return nil, ErrNotInstalled
		}
		return nil, fmt.Errorf("start tailscale serve: %w", err)
	}

	var (
		mu    sync.Mutex
		lines []string
		kept  int
	)
	ready := make(chan struct{})
	read := make(chan struct{})
	go func() {
		defer close(read)
		defer func() { _ = reader.Close() }()
		scanner := bufio.NewScanner(reader)
		signalled := false
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			if kept < maxOutput {
				lines = append(lines, line)
				kept += len(line)
			}
			mu.Unlock()
			if !signalled && strings.Contains(line, servingMessage) {
				signalled = true
				close(ready)
			}
		}
	}()
	serving := &Serving{done: make(chan struct{})}
	go func() {
		waitErr := command.Wait()
		// Exiting unasked is a failure, whatever the exit status.
		unasked := ctx.Err() == nil
		cancel()
		// Output ends with the process; an error then reads it whole.
		<-read
		if unasked {
			mu.Lock()
			serving.err = explain(strings.Join(lines, "\n"), waitErr)
			mu.Unlock()
		}
		close(serving.done)
	}()

	timeout := c.ReadyTimeout
	if timeout <= 0 {
		timeout = DefaultReadyTimeout
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ready:
		return serving, nil
	case <-serving.done:
		if serving.err == nil {
			return nil, fmt.Errorf("tailscale serve stopped before it started: %w", parent.Err())
		}
		return nil, serving.err
	case <-timer.C:
		cancel()
		<-serving.done
		mu.Lock()
		text := strings.TrimSpace(strings.Join(lines, "\n"))
		mu.Unlock()
		return nil, fmt.Errorf("tailscale serve did not start within %s: %s", timeout, text)
	}
}

// explain turns a serve's output into the error with its fix.
func explain(text string, err error) error {
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "access denied"), strings.Contains(lower, "permission denied"):
		return fmt.Errorf("%w: %s", ErrPermission, output(text, err))
	case strings.Contains(lower, "https") && (strings.Contains(lower, "enabl") || strings.Contains(lower, "certificate")):
		return fmt.Errorf("%w: %s", ErrHTTPSDisabled, output(text, err))
	}
	return fmt.Errorf("tailscale serve: %s", output(text, err))
}

func output(text string, err error) string {
	if text = strings.TrimSpace(text); text != "" {
		return text
	}
	if err != nil {
		return err.Error()
	}
	return "exited"
}

func (c *Client) binary() (string, error) {
	if c.Path != "" {
		return c.Path, nil
	}
	if path, err := exec.LookPath("tailscale"); err == nil {
		return path, nil
	}
	if goruntime.GOOS == "darwin" {
		if _, err := os.Stat(macOSApp); err == nil {
			return macOSApp, nil
		}
	}
	return "", ErrNotInstalled
}

func notInstalled(err error) bool {
	return errors.Is(err, exec.ErrNotFound) || errors.Is(err, fs.ErrNotExist)
}
