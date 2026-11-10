package connection

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/flexdinesh/zero/pkg/contract"
)

// execHandshakeTimeout bounds starting the command and its first answer.
const execHandshakeTimeout = 30 * time.Second

// execExitWait is how long a closed command has to exit before it is killed.
const execExitWait = 5 * time.Second

// stderrTail is how much of a command's standard error a failure quotes.
const stderrTail = 2 << 10

// ErrClosed reports a request on a closed ExecTransport.
var ErrClosed = errors.New("this connection is closed")

// Exec is a zero server a command serves on its standard input and output:
// `zero serve-stdio`, run where the files are (decision 0127). The bytes are
// HTTP/2 without TLS, with prior knowledge. The pipe belongs to the two
// processes, so it carries no token.
type Exec struct {
	Argv []string
	// Env is the command's environment; nil inherits this process's.
	Env []string
}

// BaseURL implements Endpoint.
func (Exec) BaseURL() string { return "http://localhost" }

// RoundTripper implements Endpoint: a new Transport.
func (e Exec) RoundTripper() http.RoundTripper { return e.Transport() }

// Transport returns a transport that starts the command on first use.
func (e Exec) Transport() *ExecTransport {
	return &ExecTransport{exec: e, pingEvery: healthPingEvery, pingTimeout: healthPingTimeout}
}

// ExecTransport runs one command at a time and sends every request over its
// one HTTP/2 connection, event streams included. When the command exits, the
// next request starts it again. Close ends it.
type ExecTransport struct {
	exec                   Exec
	pingEvery, pingTimeout time.Duration

	mu      sync.Mutex
	current *execProcess
	closed  bool
}

// Connect starts the command unless it runs, and returns the server's
// description.
func (t *ExecTransport) Connect(ctx context.Context) (contract.RemoteInfo, error) {
	process, err := t.process(ctx)
	if err != nil {
		return contract.RemoteInfo{}, err
	}
	return process.info, nil
}

// RoundTrip implements http.RoundTripper.
func (t *ExecTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	process, err := t.process(request.Context())
	if err != nil {
		if request.Body != nil {
			_ = request.Body.Close()
		}
		return nil, err
	}
	return process.conn.RoundTrip(request)
}

// Close ends the command: it sees its input end, and is killed if it has not
// exited soon after. Requests in flight fail.
func (t *ExecTransport) Close() error {
	t.mu.Lock()
	process := t.current
	t.current, t.closed = nil, true
	t.mu.Unlock()
	if process != nil {
		process.close()
	}
	return nil
}

// process returns the running command, starting one when there is none or
// the last one's connection is gone.
func (t *ExecTransport) process(ctx context.Context) (*execProcess, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil, ErrClosed
	}
	if t.current != nil {
		if t.current.conn.Err() == nil {
			return t.current, nil
		}
		go t.current.close()
		t.current = nil
	}
	process, err := t.start(ctx)
	if err != nil {
		return nil, err
	}
	t.current = process
	return process, nil
}

// execProcess is one run of the command and its connection.
type execProcess struct {
	cmd    *exec.Cmd
	stream *streamConn
	conn   *http.ClientConn
	info   contract.RemoteInfo
	stderr *tailWriter
	exited chan struct{}
}

func (t *ExecTransport) start(ctx context.Context) (*execProcess, error) {
	if len(t.exec.Argv) == 0 {
		return nil, errors.New("no command to run")
	}
	name := filepath.Base(t.exec.Argv[0])
	ctx, cancel := context.WithTimeout(ctx, execHandshakeTimeout)
	defer cancel()

	// Plain pipes: Wait never touches this side, so reading may outlast it.
	childIn, stdin, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	stdout, childOut, err := os.Pipe()
	if err != nil {
		_ = childIn.Close()
		_ = stdin.Close()
		return nil, err
	}
	stderr := &tailWriter{limit: stderrTail}
	cmd := exec.Command(t.exec.Argv[0], t.exec.Argv[1:]...)
	cmd.Env = t.exec.Env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = childIn, childOut, stderr
	err = cmd.Start()
	_ = childIn.Close()
	_ = childOut.Close()
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("start %s: %w", name, err)
	}
	stream := &streamConn{reader: stdout, writer: stdin}
	process := &execProcess{cmd: cmd, stream: stream, stderr: stderr, exited: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		close(process.exited)
		// A command that exits leaves nothing to read; end its streams now.
		_ = stream.Close()
	}()

	transport := &http.Transport{
		Proxy:       nil,
		DialContext: func(context.Context, string, string) (net.Conn, error) { return stream, nil },
		HTTP2:       &http.HTTP2Config{SendPingTimeout: t.pingEvery, PingTimeout: t.pingTimeout},
	}
	transport.Protocols = new(http.Protocols)
	transport.Protocols.SetUnencryptedHTTP2(true)
	process.conn, err = transport.NewClientConn(ctx, "http", "localhost:80")
	if err == nil {
		process.info, err = handshake(ctx, process.conn)
	}
	if err != nil {
		process.close()
		if said := stderr.String(); said != "" {
			return nil, fmt.Errorf("%s did not answer as a zero server: %s", name, said)
		}
		return nil, fmt.Errorf("%s did not answer as a zero server: %w", name, err)
	}
	return process, nil
}

// handshake asks the server to describe itself.
func handshake(ctx context.Context, conn *http.ClientConn) (contract.RemoteInfo, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://localhost"+contract.RemoteInfoPath, nil)
	if err != nil {
		return contract.RemoteInfo{}, err
	}
	response, err := conn.RoundTrip(request)
	if err != nil {
		return contract.RemoteInfo{}, err
	}
	defer func() { _ = response.Body.Close() }()
	return readInfo(response)
}

// close ends the connection, so the command reads the end of its input, and
// kills it if it has not exited soon after.
func (p *execProcess) close() {
	if p.conn != nil {
		_ = p.conn.Close()
	}
	_ = p.stream.Close()
	select {
	case <-p.exited:
		return
	case <-time.After(execExitWait):
	}
	_ = p.cmd.Process.Kill()
	<-p.exited
}

// streamConn is a net.Conn over a command's output and input. It has no
// addresses or deadlines.
type streamConn struct {
	reader *os.File
	writer *os.File
	once   sync.Once
}

func (c *streamConn) Read(p []byte) (int, error)  { return c.reader.Read(p) }
func (c *streamConn) Write(p []byte) (int, error) { return c.writer.Write(p) }

func (c *streamConn) Close() error {
	c.once.Do(func() {
		_ = c.writer.Close()
		_ = c.reader.Close()
	})
	return nil
}

func (*streamConn) LocalAddr() net.Addr              { return stdioAddr{} }
func (*streamConn) RemoteAddr() net.Addr             { return stdioAddr{} }
func (*streamConn) SetDeadline(time.Time) error      { return nil }
func (*streamConn) SetReadDeadline(time.Time) error  { return nil }
func (*streamConn) SetWriteDeadline(time.Time) error { return nil }

type stdioAddr struct{}

func (stdioAddr) Network() string { return "stdio" }
func (stdioAddr) String() string  { return "stdio" }

// tailWriter keeps the last limit bytes written.
type tailWriter struct {
	limit int

	mu   sync.Mutex
	tail []byte
}

func (w *tailWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.tail = append(w.tail, p...)
	if extra := len(w.tail) - w.limit; extra > 0 {
		w.tail = w.tail[extra:]
	}
	return len(p), nil
}

// String is the kept text, trimmed.
func (w *tailWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return strings.TrimSpace(string(w.tail))
}
