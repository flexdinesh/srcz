package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/flexdinesh/zero/pkg/connection"
	"github.com/flexdinesh/zero/pkg/contract"
)

// sandboxEnv makes the test binary play `zero connection stdio <id>`: "serve"
// answers on standard input and output as zero in a sandbox does, "gone" fails
// as one whose container has gone.
const sandboxEnv = "ZERO_PROXY_TEST_SANDBOX"

func TestMain(m *testing.M) {
	switch os.Getenv(sandboxEnv) {
	case "":
		os.Exit(m.Run())
	case "serve":
		serveSandbox()
	case "gone":
		_, _ = fmt.Fprintln(os.Stderr, "Error: no container \"3f2a9c1b7d4e\": `docker ps` lists the running ones")
		os.Exit(1)
	}
	os.Exit(0)
}

// serveSandbox serves the stdio wire: HTTP/2 without TLS on standard input
// and output. It exits when its input ends.
func serveSandbox() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+contract.RemoteInfoPath, func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(contract.RemoteInfo{Protocol: 1, Version: "test", Name: "sandbox"})
	})
	mux.HandleFunc("GET /api/projects", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"host": r.Host, "cookie": r.Header.Get("Cookie"), "authorization": r.Header.Get("Authorization"), "pid": strconv.Itoa(os.Getpid())})
	})
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: status\ndata: {}\n\n")
		_ = http.NewResponseController(w).Flush()
		<-r.Context().Done()
	})
	server := &http.Server{Handler: mux}
	server.Protocols = new(http.Protocols)
	server.Protocols.SetUnencryptedHTTP2(true)
	listener := &oneConn{conns: make(chan net.Conn, 1)}
	listener.conns <- stdioConn{}
	_ = server.Serve(listener)
}

// stdioConn is this process's standard input and output; closing it ends the
// process, as the end of zero's input does.
type stdioConn struct{}

func (stdioConn) Read(p []byte) (int, error)       { return os.Stdin.Read(p) }
func (stdioConn) Write(p []byte) (int, error)      { return os.Stdout.Write(p) }
func (stdioConn) Close() error                     { os.Exit(0); return nil }
func (stdioConn) LocalAddr() net.Addr              { return &net.UnixAddr{Name: "stdio"} }
func (stdioConn) RemoteAddr() net.Addr             { return &net.UnixAddr{Name: "stdio"} }
func (stdioConn) SetDeadline(time.Time) error      { return nil }
func (stdioConn) SetReadDeadline(time.Time) error  { return nil }
func (stdioConn) SetWriteDeadline(time.Time) error { return nil }

// oneConn accepts one connection, then waits.
type oneConn struct{ conns chan net.Conn }

func (l *oneConn) Accept() (net.Conn, error) {
	conn, ok := <-l.conns
	if !ok {
		return nil, net.ErrClosed
	}
	return conn, nil
}
func (l *oneConn) Close() error   { return nil }
func (l *oneConn) Addr() net.Addr { return &net.UnixAddr{Name: "stdio"} }

var sandboxSaved = connection.Saved{
	ID:      connection.SandboxID("docker", "engine-1", "3f2a9c1b7d4e"),
	Label:   "docker://web/src",
	Sandbox: &connection.SavedSandbox{Provider: "docker", Ref: "3f2a9c1b7d4e", Path: "/src"},
}

// sandboxProxy serves sandboxSaved through this test binary in mode.
func sandboxProxy(t *testing.T, mode string) (*Proxy, *Connections) {
	t.Helper()
	t.Setenv(sandboxEnv, mode)
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeStore{}
	store.put(sandboxSaved)
	connections := NewConnections(&fakeDaemon{}, store, self)
	p := New(connections)
	t.Cleanup(p.Close)
	return p, connections
}

type sandboxAnswer struct{ Host, Cookie, Authorization, PID string }

func projectsThrough(t *testing.T, p *Proxy) sandboxAnswer {
	t.Helper()
	r := request(http.MethodGet, OriginOf(sandboxSaved.ID)+"/api/projects", nil)
	r.Header.Set("Accept", "application/json")
	r.Header.Set("Cookie", "page=cookie")
	r.Header.Set("Authorization", "Bearer from-the-page")
	recorder := httptest.NewRecorder()
	p.ServeHTTP(recorder, r)
	var answer sandboxAnswer
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &answer) != nil {
		t.Fatalf("response %d %q", recorder.Code, recorder.Body.String())
	}
	return answer
}

func projectsOver(t *testing.T, endpoint connection.Endpoint) (sandboxAnswer, error) {
	t.Helper()
	r, err := http.NewRequestWithContext(t.Context(), http.MethodGet, endpoint.BaseURL()+"/api/projects", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := endpoint.RoundTripper().RoundTrip(r)
	if err != nil {
		return sandboxAnswer{}, err
	}
	defer func() { _ = response.Body.Close() }()
	var answer sandboxAnswer
	return answer, json.NewDecoder(response.Body).Decode(&answer)
}

func TestSandboxForwardsThroughItsCommand(t *testing.T) {
	p, connections := sandboxProxy(t, "serve")
	answer := projectsThrough(t, p)
	if answer.Host != "localhost" || answer.Cookie != "" || answer.Authorization != "" {
		t.Fatalf("upstream saw %+v", answer)
	}
	// The rest of the app shares the page's zero: one command per connection.
	endpoint, found, err := connections.Endpoint(sandboxSaved.ID)
	if err != nil || !found {
		t.Fatalf("Endpoint = %v, %v", found, err)
	}
	shared, err := projectsOver(t, endpoint)
	if err != nil || shared.PID != answer.PID {
		t.Fatalf("the endpoint reached %+v, %v; the page reached pid %s", shared, err, answer.PID)
	}
	if _, found, err := connections.Endpoint("s-000000000000"); found || err != nil {
		t.Errorf("an unsaved sandbox: found %v, %v", found, err)
	}

	// Its window closing ends the command; the next page starts another.
	connections.Drop(sandboxSaved.ID)
	if _, err := projectsOver(t, endpoint); !errors.Is(err, connection.ErrClosed) {
		t.Fatalf("after Drop the old transport answers %v", err)
	}
	if again := projectsThrough(t, p); again.PID == answer.PID {
		t.Errorf("after Drop the same command answers")
	}
}

func TestSandboxStreamsEventsWithKeepalives(t *testing.T) {
	p, _ := sandboxProxy(t, "serve")
	p.keepalive = 20 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writer := &streamWriter{header: http.Header{}, cancel: cancel, chunks: make(chan string, 64)}
	r := request(http.MethodGet, OriginOf(sandboxSaved.ID)+"/api/events?project=x", nil).WithContext(ctx)
	r.Header.Set("Accept", "text/event-stream")
	done := make(chan struct{})
	go func() {
		defer close(done)
		p.ServeHTTP(writer, r)
	}()
	var seen strings.Builder
	deadline := time.After(10 * time.Second)
	for !strings.Contains(seen.String(), "event: status") || !strings.Contains(seen.String(), ": keepalive") {
		select {
		case chunk := <-writer.chunks:
			seen.WriteString(chunk)
		case <-deadline:
			t.Fatalf("stream so far %q", seen.String())
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the stream outlived the page")
	}
}

func TestSandboxRefusesControlAPIs(t *testing.T) {
	p, _ := sandboxProxy(t, "serve")
	for _, path := range []string{"/_daemon/status", "/_zero/remote"} {
		recorder := httptest.NewRecorder()
		p.ServeHTTP(recorder, request(http.MethodGet, OriginOf(sandboxSaved.ID)+path, nil))
		if recorder.Code != http.StatusForbidden {
			t.Errorf("%s: status %d, want 403", path, recorder.Code)
		}
	}
}

func TestAGoneSandboxSaysToAttachAgain(t *testing.T) {
	p, _ := sandboxProxy(t, "gone")
	r := request(http.MethodGet, OriginOf(sandboxSaved.ID)+"/", nil)
	r.Header.Set("Accept", "text/html")
	recorder := httptest.NewRecorder()
	p.ServeHTTP(recorder, r)
	body := recorder.Body.String()
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(body, "zero attach docker://web/src") || !strings.Contains(body, "no container") || !strings.Contains(body, `href="/"`) {
		t.Errorf("page %d %q", recorder.Code, body)
	}

	r = request(http.MethodGet, OriginOf(sandboxSaved.ID)+"/api/projects", nil)
	r.Header.Set("Accept", "application/json")
	recorder = httptest.NewRecorder()
	p.ServeHTTP(recorder, r)
	var answer contract.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &answer); err != nil || answer.Code != "sandboxUnavailable" || !strings.Contains(answer.Error, "no container") {
		t.Errorf("api %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestASandboxNeedsAZeroBinary(t *testing.T) {
	store := &fakeStore{}
	store.put(sandboxSaved)
	p := New(NewConnections(&fakeDaemon{}, store, ""))
	t.Cleanup(p.Close)
	r := request(http.MethodGet, OriginOf(sandboxSaved.ID)+"/", nil)
	r.Header.Set("Accept", "text/html")
	recorder := httptest.NewRecorder()
	p.ServeHTTP(recorder, r)
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), "no zero binary") {
		t.Errorf("page %d %q", recorder.Code, recorder.Body.String())
	}
}
