// Package stdio serves the web app over one byte stream, such as a process's
// standard input and output: HTTP/2 without TLS, with prior knowledge
// (decision 0127). pkg/connection's Exec is the other end. It knows no
// process, container, or sandbox.
package stdio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/flexdinesh/zero/pkg/contract"
)

// Serve serves handler on stream until the peer closes it or ctx ends, and
// answers contract.RemoteInfoPath with info. It closes stream. There is one
// peer and no idle timeout: the stream ends only when the peer is done.
func Serve(ctx context.Context, stream io.ReadWriteCloser, handler http.Handler, info contract.RemoteInfo) error {
	conn := &streamConn{stream: stream, closed: make(chan struct{})}
	listener := &oneListener{conn: make(chan net.Conn, 1), done: make(chan struct{})}
	listener.conn <- conn
	server := &http.Server{Handler: withInfo(info, handler)}
	server.Protocols = new(http.Protocols)
	server.Protocols.SetUnencryptedHTTP2(true)
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	select {
	case <-conn.closed:
	case <-ctx.Done():
	case err := <-served:
		_ = conn.Close()
		return fmt.Errorf("serve over stdio: %w", err)
	}
	_ = server.Close()
	_ = conn.Close()
	if err := <-served; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve over stdio: %w", err)
	}
	return nil
}

// withInfo answers contract.RemoteInfoPath; every other request is next's.
func withInfo(info contract.RemoteInfo, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != contract.RemoteInfoPath {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			_ = json.NewEncoder(w).Encode(contract.ErrorResponse{Error: "Method not allowed."})
			return
		}
		_ = json.NewEncoder(w).Encode(info)
	})
}

// oneListener accepts its one connection, then waits to be closed.
type oneListener struct {
	conn chan net.Conn
	once sync.Once
	done chan struct{}
}

func (l *oneListener) Accept() (net.Conn, error) {
	select {
	case conn := <-l.conn:
		return conn, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}

func (l *oneListener) Close() error {
	l.once.Do(func() { close(l.done) })
	return nil
}

func (*oneListener) Addr() net.Addr { return addr{} }

// streamConn is a net.Conn over stream. It has no addresses or deadlines, and
// reports its close.
type streamConn struct {
	stream io.ReadWriteCloser
	once   sync.Once
	closed chan struct{}
}

func (c *streamConn) Read(p []byte) (int, error)  { return c.stream.Read(p) }
func (c *streamConn) Write(p []byte) (int, error) { return c.stream.Write(p) }

func (c *streamConn) Close() error {
	c.once.Do(func() {
		_ = c.stream.Close()
		close(c.closed)
	})
	return nil
}

func (*streamConn) LocalAddr() net.Addr              { return addr{} }
func (*streamConn) RemoteAddr() net.Addr             { return addr{} }
func (*streamConn) SetDeadline(time.Time) error      { return nil }
func (*streamConn) SetReadDeadline(time.Time) error  { return nil }
func (*streamConn) SetWriteDeadline(time.Time) error { return nil }

type addr struct{}

func (addr) Network() string { return "stdio" }
func (addr) String() string  { return "stdio" }
