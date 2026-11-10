package daemon

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/flexdinesh/zero/internal/app"
	"github.com/flexdinesh/zero/internal/remote"
	"github.com/flexdinesh/zero/internal/runtime"
	"github.com/flexdinesh/zero/internal/tailscale"
	"github.com/flexdinesh/zero/internal/web"
	"github.com/flexdinesh/zero/pkg/contract"
)

// DefaultTailscalePort is the HTTPS port the tailnet reaches zero on: zero's
// first default port, so a peer knows where to look (decision 0126).
const DefaultTailscalePort = 7971

// tailscaleStatusTimeout bounds asking tailscaled for this machine's name.
const tailscaleStatusTimeout = 10 * time.Second

// tailscaleServer is the Tailscale exposure: a private loopback listener that
// a foreground `tailscale serve` proxies the tailnet to. Its Host policy
// allows this machine's MagicDNS name, which serve forwards. Tailscale
// cannot reach a Unix socket for a user who is not root, so the listener is
// TCP on 127.0.0.1, which other users of this machine can reach, as they can
// a `zero browser` server (decision 0126).
type tailscaleServer struct {
	runtime  *runtime.Runtime
	client   *tailscale.Client
	policy   Lifetime
	idle     *idleTracker
	exit     func()
	after    timerFunc
	log      io.Writer
	lifetime *uiLifetime

	// starting serializes starts, which wait on Tailscale without holding mu.
	starting sync.Mutex
	mu       sync.Mutex
	serving  *tailscaleServing
}

// tailscaleServing is one serve and the listener it proxies to.
type tailscaleServing struct {
	bound *runtime.Bound
	serve *tailscale.Serving
	stop  context.CancelFunc
	name  string
	port  int
}

// close stops the serve, waits for Tailscale to drop it, and closes the
// listener.
func (s *tailscaleServing) close() {
	s.stop()
	<-s.serve.Done()
	s.bound.Close()
}

func newTailscaleServer(rt *runtime.Runtime, client *tailscale.Client, policy Lifetime, idle *idleTracker, exit func(), log io.Writer) *tailscaleServer {
	t := &tailscaleServer{runtime: rt, client: client, policy: policy, idle: idle, exit: exit, after: realTimer, log: log}
	t.lifetime = &uiLifetime{after: t.after, fire: func() {
		_, _ = fmt.Fprintln(t.log, "tailscale serve closing: no UI connected")
		t.closeListener()
	}}
	return t
}

// Status implements Exposure.
func (t *tailscaleServer) Status() contract.DaemonRemote {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.statusLocked()
}

func (t *tailscaleServer) statusLocked() contract.DaemonRemote {
	if t.serving == nil {
		return contract.DaemonRemote{}
	}
	return contract.DaemonRemote{Listening: true, Host: t.serving.name, Port: t.serving.port, Clients: t.lifetime.count()}
}

// Start implements Exposure.
func (t *tailscaleServer) Start(request contract.DaemonRemoteRequest) (contract.DaemonRemote, error) {
	first, err := remoteDuration(request.FirstWait, t.policy.FirstWait)
	if err != nil {
		return contract.DaemonRemote{}, err
	}
	grace, err := remoteDuration(request.Grace, t.policy.Grace)
	if err != nil {
		return contract.DaemonRemote{}, err
	}
	if request.Host != "" {
		return contract.DaemonRemote{}, invalidRemote("Host does not apply to Tailscale: the tailnet reaches this machine by its MagicDNS name.")
	}
	port := DefaultTailscalePort
	if request.Port != nil {
		port = *request.Port
	}
	if port < 1 || port > 65535 {
		return contract.DaemonRemote{}, invalidRemote("Port must be between 1 and 65535.")
	}
	t.starting.Lock()
	defer t.starting.Unlock()
	t.mu.Lock()
	if t.serving != nil && t.serving.port == port {
		t.lifetime.start(first, grace)
		status := t.statusLocked()
		t.mu.Unlock()
		return status, nil
	}
	t.mu.Unlock()

	serving, err := t.serve(port)
	if err != nil {
		return contract.DaemonRemote{}, err
	}
	// Logged before the wait for a UI starts, which logs when it ends.
	_, _ = fmt.Fprintf(t.log, "tailscale serving https://%s/\n", net.JoinHostPort(serving.name, strconv.Itoa(port)))
	t.mu.Lock()
	old := t.serving
	t.serving = serving
	t.lifetime.start(first, grace)
	status := t.statusLocked()
	t.mu.Unlock()
	if old != nil {
		old.close()
	}
	go t.watch(serving)
	return status, nil
}

// serve asks Tailscale for this machine's name, listens, and starts a
// foreground `tailscale serve` to the listener.
func (t *tailscaleServer) serve(port int) (*tailscaleServing, error) {
	ctx, cancel := context.WithTimeout(context.Background(), tailscaleStatusTimeout)
	status, err := t.client.Status(ctx)
	cancel()
	if err == nil {
		err = status.CanServe()
	}
	if err != nil {
		return nil, tailscaleError(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, &app.Error{Kind: contract.KindInternal, Message: "Listen: " + err.Error()}
	}
	target := "http://" + listener.Addr().String()
	bound, err := t.runtime.Bind(runtime.Binding{Listener: listener, Handler: t.handler(status.DNSName), WriteTimeout: remoteWriteTimeout})
	if err != nil {
		return nil, &app.Error{Kind: contract.KindUnavailable, Message: err.Error()}
	}
	ctx, stop := context.WithCancel(context.Background())
	served, err := t.client.Serve(ctx, port, target)
	if err != nil {
		stop()
		bound.Close()
		return nil, tailscaleError(err)
	}
	return &tailscaleServing{bound: bound, serve: served, stop: stop, name: status.DNSName, port: port}, nil
}

// watch closes the exposure when its serve exits unasked, as when tailscaled
// restarts.
func (t *tailscaleServer) watch(serving *tailscaleServing) {
	<-serving.serve.Done()
	err := serving.serve.Err()
	if err == nil {
		return
	}
	t.mu.Lock()
	current := t.serving == serving
	t.mu.Unlock()
	if current {
		_, _ = fmt.Fprintf(t.log, "tailscale serve stopped: %v\n", err)
		t.closeListener()
	}
}

// handler composes what the tailnet adds to the web app. Tailscale
// authenticates, so /_zero/remote answers without a token, behind the same
// Host policy as the app.
func (t *tailscaleServer) handler(name string) http.Handler {
	policy := web.HostPolicy{AllowedHosts: []string{name}}
	return t.idle.wrap(policy.Guard(remote.Info(remoteInfo(), t.lifetime.track(remote.Compress(t.runtime.HandlerFor(policy))))))
}

// Stop implements Exposure.
func (t *tailscaleServer) Stop() contract.DaemonRemote {
	t.closeListener()
	return contract.DaemonRemote{}
}

// closeListener stops serving, then exits the daemon if nothing else needs
// it.
func (t *tailscaleServer) closeListener() {
	t.lifetime.stop()
	t.mu.Lock()
	serving := t.serving
	t.serving = nil
	t.mu.Unlock()
	if serving != nil {
		serving.close()
	}
	t.after(remoteSettle, func() {
		t.mu.Lock()
		listening := t.serving != nil
		t.mu.Unlock()
		if !listening && t.idle.quiet() {
			t.exit()
		}
	})
}

// shutdown stops the timers and the serve when the daemon stops; Serve
// closes the binding.
func (t *tailscaleServer) shutdown() {
	t.lifetime.stop()
	t.mu.Lock()
	serving := t.serving
	t.serving = nil
	t.mu.Unlock()
	if serving != nil {
		serving.stop()
		<-serving.serve.Done()
	}
}

func tailscaleError(err error) error {
	return &app.Error{Kind: contract.KindUnavailable, Code: contract.CodeTailscaleUnavailable, Message: err.Error()}
}
