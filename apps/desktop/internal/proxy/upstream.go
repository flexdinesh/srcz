package proxy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"reflect"
	"sync"
	"time"

	"github.com/flexdinesh/zero/apps/desktop/internal/connect"
	"github.com/flexdinesh/zero/pkg/connection"
)

// Failure is a request that got no answer: JSON for the page's requests, a
// page of the app's own for a page load.
type Failure struct {
	Status      int
	Code        string
	Title       string
	Detail      string
	jsonMessage string
}

func (f *Failure) Error() string { return f.Detail }

// message is what a page's request reads.
func (f *Failure) message() string {
	if f.jsonMessage != "" {
		return f.jsonMessage
	}
	return f.Detail
}

// Upstream is the server of one connection.
type Upstream interface {
	// Send makes the request. document says a person asked for a page, so a
	// recent failure is worth retrying now. Failures are *Failure.
	Send(r *http.Request, body []byte, document bool) (*http.Response, error)
	Close()
}

// Resolver finds the server behind a scheme host: one connection per origin.
type Resolver interface {
	// Resolve returns host's server; a failure means it has none.
	Resolve(host string, document bool) (Upstream, *Failure)
	Close()
}

// Store is the saved connections.
type Store interface {
	Lookup(id string) (connection.Saved, bool, error)
}

// Connections resolves "local" to the daemon and connection ids to saved
// servers: remote ones over TLS, and sandboxes through `zero connection
// stdio` (decision 0128). A page load reads the store again, so running
// `zero connect` with new addresses applies to a window already open.
type Connections struct {
	local *Local
	store Store
	// zero is the zero binary sandbox connections run; "" when there is none.
	zero string

	mu      sync.Mutex
	remotes map[string]*Remote
}

// NewConnections returns the app's connections. zero is the zero binary that
// serves sandbox connections.
func NewConnections(daemon Daemon, store Store, zero string) *Connections {
	return &Connections{local: NewLocal(daemon), store: store, zero: zero, remotes: map[string]*Remote{}}
}

// errNotSaved is a connection id the store does not have.
var errNotSaved = errors.New("no such saved connection")

// Resolve implements Resolver.
func (c *Connections) Resolve(host string, document bool) (Upstream, *Failure) {
	if host == Host {
		return c.local, nil
	}
	remote, err := c.remote(host, document)
	switch {
	case errors.Is(err, errNotSaved):
		return nil, notPaired()
	case errors.Is(err, errStore):
		return nil, &Failure{Status: http.StatusServiceUnavailable, Code: "connectionsUnavailable", Title: "zero can't read its saved connections", Detail: err.Error()}
	case err != nil:
		return nil, &Failure{Status: http.StatusServiceUnavailable, Code: "connectionsUnavailable", Title: "zero can't read this saved connection", Detail: err.Error()}
	}
	return remote, nil
}

// Endpoint is how the rest of the app reaches a saved connection's server:
// through the transport its pages use, so a sandbox runs one zero for both.
// It reads the store again, as a page load does; found is false when host is
// not a saved connection.
func (c *Connections) Endpoint(host string) (endpoint connection.Endpoint, found bool, err error) {
	remote, err := c.remote(host, true)
	if errors.Is(err, errNotSaved) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return remote, true, nil
}

// errStore is a store that could not be read.
var errStore = errors.New("read saved connections")

// remote returns host's server. reread reads the store again, replacing the
// server when its connection changed; a store that cannot be read keeps the
// one in use.
func (c *Connections) remote(host string, reread bool) (*Remote, error) {
	if !connection.IsID(host) {
		return nil, errNotSaved
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	existing := c.remotes[host]
	if existing != nil && !reread {
		return existing, nil
	}
	saved, found, err := c.store.Lookup(host)
	if err != nil {
		if existing != nil {
			return existing, nil
		}
		return nil, fmt.Errorf("%w: %w", errStore, err)
	}
	if !found {
		if existing != nil {
			existing.Close()
			delete(c.remotes, host)
		}
		return nil, errNotSaved
	}
	if existing != nil && sameConnection(existing.saved, saved) {
		return existing, nil
	}
	created, err := newRemote(saved, c.zero)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		existing.Close()
	}
	c.remotes[host] = created
	return created, nil
}

// Drop ends a saved connection's server when its window closes: a sandbox's
// zero stops.
func (c *Connections) Drop(host string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if remote := c.remotes[host]; remote != nil {
		remote.Close()
		delete(c.remotes, host)
	}
}

// Label names a saved connection for people; "" when there is none.
func (c *Connections) Label(host string) string {
	saved, found, err := c.store.Lookup(host)
	if err != nil || !found {
		return ""
	}
	return saved.Label
}

// Known reports a host pages can load from: the daemon, or a saved connection.
func (c *Connections) Known(host string) bool {
	if host == Host {
		return true
	}
	if !connection.IsID(host) {
		return false
	}
	_, found, err := c.store.Lookup(host)
	return err == nil && found
}

// Close ends every server's connections.
func (c *Connections) Close() {
	c.local.Close()
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, remote := range c.remotes {
		remote.Close()
	}
}

// NotPairedDetail says how to save a connection.
const NotPairedDetail = "Run `zero connect` with the string `zero <path> --remote` prints on the server, or `zero attach` with a container."

func notPaired() *Failure {
	return &Failure{
		Status: http.StatusNotFound,
		Code:   "unknownConnection",
		Title:  "This computer has no such zero connection",
		Detail: NotPairedDetail,
	}
}

// Daemon is where the local connection's requests go: the ensured daemon's
// socket.
type Daemon interface {
	// Socket returns the socket, ensuring when needed; force retries now
	// after a recent failure.
	Socket(ctx context.Context, force bool) (string, error)
	// Reensure ensures again after the daemon stopped answering.
	Reensure(ctx context.Context) (string, error)
}

// Local is the per-user daemon, started again when it has gone.
type Local struct {
	daemon    Daemon
	transport *http.Transport

	mu     sync.Mutex
	socket string
}

// NewLocal returns the local connection.
func NewLocal(daemon Daemon) *Local {
	l := &Local{daemon: daemon}
	l.transport = &http.Transport{
		// The socket can change when the daemon restarts.
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", l.currentSocket())
		},
		MaxIdleConnsPerHost: 16,
		IdleConnTimeout:     90 * time.Second,
		// Bytes pass through as the daemon sent them.
		DisableCompression: true,
	}
	return l
}

// Close implements Upstream.
func (l *Local) Close() { l.transport.CloseIdleConnections() }

func (l *Local) currentSocket() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.socket
}

func (l *Local) setSocket(socket string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.socket = socket
}

// Send implements Upstream. A page load retries at once after a failure.
func (l *Local) Send(r *http.Request, body []byte, document bool) (*http.Response, error) {
	socket, err := l.daemon.Socket(r.Context(), document)
	if err != nil {
		return nil, daemonFailure(err)
	}
	l.setSocket(socket)
	response, err := l.send(r, body)
	if err != nil && connect.IsGone(err) && r.Context().Err() == nil {
		// One re-ensure, and a retry for reads only (decision 0067).
		socket, ensureErr := l.daemon.Reensure(r.Context())
		if ensureErr != nil {
			return nil, daemonFailure(ensureErr)
		}
		l.setSocket(socket)
		if !readOnly(r) {
			return nil, &Failure{Status: http.StatusServiceUnavailable, Code: "daemonRestarted", Title: "zero restarted its daemon", Detail: "The zero daemon restarted; the request was not sent. Try again."}
		}
		response, err = l.send(r, nil)
	}
	if err != nil {
		return nil, daemonFailure(err)
	}
	return response, nil
}

func (l *Local) send(r *http.Request, body []byte) (*http.Response, error) {
	upstream, err := upstreamRequest(r, connection.Unix{}.BaseURL(), body)
	if err != nil {
		return nil, err
	}
	// Keeps the daemon's control API refusing whatever arrives through a proxy.
	upstream.Header.Set("Sec-Fetch-Site", "same-origin")
	return l.transport.RoundTrip(upstream)
}

func daemonFailure(err error) *Failure {
	return &Failure{Status: http.StatusServiceUnavailable, Code: "daemonUnavailable", Title: "zero can't reach its daemon", Detail: err.Error()}
}

// Remote is a saved connection's server: over pinned TLS, or zero in a
// sandbox on a command's standard input and output. The page never sees a
// credential: only this transport adds it.
type Remote struct {
	saved     connection.Saved
	base      string
	transport http.RoundTripper
}

func newRemote(saved connection.Saved, zero string) (*Remote, error) {
	endpoint, err := saved.Endpoint(zero)
	if err != nil {
		return nil, err
	}
	return &Remote{saved: saved, base: endpoint.BaseURL(), transport: endpoint.RoundTripper()}, nil
}

// sameConnection reports a saved connection that has not changed, whenever it
// was saved.
func sameConnection(a, b connection.Saved) bool {
	a.AddedAt, b.AddedAt = time.Time{}, time.Time{}
	return reflect.DeepEqual(a, b)
}

// BaseURL implements connection.Endpoint.
func (r *Remote) BaseURL() string { return r.base }

// RoundTripper implements connection.Endpoint: the transport pages use.
func (r *Remote) RoundTripper() http.RoundTripper { return r.transport }

// Close implements Upstream: a sandbox's command ends; a remote server's idle
// connections close.
func (r *Remote) Close() {
	if closer, ok := r.transport.(io.Closer); ok {
		_ = closer.Close()
		return
	}
	if closer, ok := r.transport.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}

// Send implements Upstream.
func (r *Remote) Send(request *http.Request, body []byte, document bool) (*http.Response, error) {
	upstream, err := upstreamRequest(request, r.base, body)
	if err != nil {
		return nil, r.unreachable(err)
	}
	response, err := r.transport.RoundTrip(upstream)
	if errors.Is(err, connection.ErrFingerprint) {
		return nil, &Failure{
			Status: http.StatusBadGateway,
			Code:   "remoteIdentityChanged",
			Title:  r.saved.Label + " has a different identity",
			Detail: "Its credential was rotated, or something else answers at this address. Run `zero <path> --remote` there, then `zero connect` with the new string.",
		}
	}
	if err != nil {
		return nil, r.unreachable(err)
	}
	if response.StatusCode == http.StatusUnauthorized && document {
		_ = response.Body.Close()
		return nil, &Failure{
			Status: http.StatusUnauthorized,
			Code:   "remoteRefused",
			Title:  r.saved.Label + " refused this connection",
			Detail: "Run `zero <path> --remote` there, then `zero connect` with the new string.",
		}
	}
	return response, nil
}

// unreachable says what to do when the server does not answer, by kind.
func (r *Remote) unreachable(err error) *Failure {
	if r.saved.Sandbox != nil {
		return &Failure{
			Status:      http.StatusServiceUnavailable,
			Code:        "sandboxUnavailable",
			Title:       "zero can't reach " + r.saved.Label,
			Detail:      fmt.Sprintf("If it stopped or was replaced, start it and run `zero attach %s` again. %v", r.saved.Label, err),
			jsonMessage: fmt.Sprintf("zero can't reach %s: %v", r.saved.Label, err),
		}
	}
	return &Failure{
		Status:      http.StatusServiceUnavailable,
		Code:        "remoteUnavailable",
		Title:       "zero can't reach " + r.saved.Label,
		Detail:      "zero stops on a server when no UI needs it. Run `zero <path> --remote` there, then try again.",
		jsonMessage: fmt.Sprintf("zero can't reach %s: %v", r.saved.Label, err),
	}
}

// upstreamRequest is the request a server sees: the allowlisted headers, and
// the Host its check expects. A page's own Cookie or Authorization never pass.
func upstreamRequest(r *http.Request, base string, body []byte) (*http.Request, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	upstream, err := http.NewRequestWithContext(r.Context(), r.Method, base+r.URL.RequestURI(), reader)
	if err != nil {
		return nil, err
	}
	for _, name := range forwardedRequestHeaders {
		if values, ok := r.Header[name]; ok {
			upstream.Header[name] = values
		}
	}
	upstream.Host = "localhost"
	return upstream, nil
}

func readOnly(r *http.Request) bool {
	return r.Method == http.MethodGet || r.Method == http.MethodHead
}
