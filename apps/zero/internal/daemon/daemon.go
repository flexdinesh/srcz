// Package daemon serves zero over a per-user Unix socket (decision 0061):
// the web routes plus a /_daemon control API, persisted runtime roots, single
// instance, and idle exit. It knows no CLI flags or process spawning.
package daemon

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/flexdinesh/zero/internal/runtime"
	"github.com/flexdinesh/zero/internal/tailscale"
	"github.com/flexdinesh/zero/internal/version"
	"github.com/flexdinesh/zero/pkg/contract"
)

// ProtocolVersion versions what clients rely on: /_daemon/* and Status. Only
// a protocol mismatch blocks; /_daemon/status and /_daemon/stop keep their
// shape across protocol versions so any client can report and stop.
const ProtocolVersion = 1

// DefaultIdleExit is how long a daemon with no request in flight keeps
// running.
const DefaultIdleExit = 30 * time.Minute

// Config configures Run.
type Config struct {
	Socket    string // required
	RootsFile string // required
	Depth     int
	ScanDepth int
	// Lifetime is when the daemon and its remote listener stop on their own.
	Lifetime Lifetime
	// Log receives startup, skipped roots, and the stop reason; nil discards.
	Log io.Writer
	// IdentityFile holds the identity for serving over TCP; "" never does.
	IdentityFile string
	// Tailscale serves over Tailscale on request; nil never does (decision
	// 0126).
	Tailscale *tailscale.Client
}

var (
	errStopRequested = errors.New("stop requested")
	errIdle          = errors.New("idle")
)

// Run serves until ctx ends, /_daemon/stop, or idle exit. It loads the saved
// roots (a malformed file fails before listening), dropping missing roots and
// skipping overlapping ones, each logged (LoadedRoots), then takes the socket (ErrRunning if another
// daemon holds it) and serves the web routes and the control API.
func Run(ctx context.Context, config Config) error {
	if config.Socket == "" || config.RootsFile == "" {
		return errors.New("daemon: socket and roots file are required")
	}
	if err := config.Lifetime.validate(); err != nil {
		return err
	}
	log := config.Log
	if log == nil {
		log = io.Discard
	}
	roots, err := LoadedRoots(config.RootsFile, log)
	if err != nil {
		return err
	}
	listener, err := Listen(config.Socket)
	if err != nil {
		return err
	}
	defer func() { _ = listener.Close() }()
	rt, err := runtime.New(runtime.Config{Roots: roots.Set(), RootControl: roots, Depth: config.Depth, ScanDepth: config.ScanDepth, SessionKey: "daemon", Presence: true})
	if err != nil {
		return err
	}
	defer rt.Close()

	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	idle := newIdleTracker(config.Lifetime.IdleExit, func() { cancel(errIdle) })
	defer idle.stop()
	// An exposure closing on its own exits the daemon only if no other one
	// serves.
	exposed := &exposures{}
	exit := func() {
		if !exposed.listening() {
			cancel(errIdle)
		}
	}
	if config.IdentityFile != "" {
		server := newRemoteServer(rt, rt.Handler(), config.IdentityFile, config.Lifetime, idle, exit, log)
		defer server.shutdown()
		exposed.add(contract.RemoteExposureTLS, server)
		exposed.tls = server
	}
	if config.Tailscale != nil {
		server := newTailscaleServer(rt, config.Tailscale, config.Lifetime, idle, exit, log)
		defer server.shutdown()
		exposed.add(contract.RemoteExposureTailscale, server)
	}
	var remoteControl RemoteControl
	if len(exposed.list) > 0 {
		remoteControl = exposed
	}
	control := NewController(ControllerConfig{
		Remote:   remoteControl,
		Roots:    roots,
		Stop:     func() { cancel(errStopRequested) },
		Done:     ctx.Done(),
		Notices:  rt.Application().Walkthroughs,
		Feedback: rt.Application().Feedback,
		Status: Status{
			Protocol:  ProtocolVersion,
			Version:   version.Number(),
			PID:       pid(),
			Socket:    config.Socket,
			Depth:     config.Depth,
			ScanDepth: config.ScanDepth,
			IdleExit:  config.Lifetime.IdleExit.String(),
			StartedAt: time.Now().UTC().Truncate(time.Second),
		},
	})
	_, _ = fmt.Fprintf(log, "zero daemon %s (protocol %d) listening on %s with %d roots\n", version.Number(), ProtocolVersion, config.Socket, len(roots.Set().List()))
	err = rt.Serve(ctx, listener, idle.wrap(control.Handler(rt.Handler())))
	_, _ = fmt.Fprintf(log, "zero daemon stopped: %v\n", context.Cause(ctx))
	return err
}
