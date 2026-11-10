package connection

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/flexdinesh/zero/internal/stdio"
	"github.com/flexdinesh/zero/pkg/contract"
)

// helperEnv makes the test binary a stdio server instead (TestMain).
const helperEnv = "ZERO_EXEC_TEST_HELPER"

func TestMain(m *testing.M) {
	switch os.Getenv(helperEnv) {
	case "":
		os.Exit(m.Run())
	case "serve":
		serveHelper()
	case "refuse":
		_, _ = fmt.Fprintln(os.Stderr, "Error: No such container: gone")
		os.Exit(1)
	}
	os.Exit(0)
}

// serveHelper answers /pid, /exit, and /events (one event per /emit) on its
// standard input and output, then writes its pid to $ZERO_EXEC_TEST_DONE.
func serveHelper() {
	emit := make(chan string)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /pid", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strconv.Itoa(os.Getpid()))
	})
	mux.HandleFunc("POST /exit", func(http.ResponseWriter, *http.Request) { os.Exit(0) })
	mux.HandleFunc("POST /emit", func(w http.ResponseWriter, r *http.Request) {
		emit <- r.URL.Query().Get("data")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		controller := http.NewResponseController(w)
		_, _ = io.WriteString(w, ": ready\n")
		_ = controller.Flush()
		for {
			select {
			case data := <-emit:
				_, _ = fmt.Fprintf(w, "data: %s\n", data)
				_ = controller.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})
	info := contract.RemoteInfo{Protocol: 1, Version: "test", Name: "helper"}
	_ = stdio.Serve(context.Background(), stdioStream{}, mux, info)
	if done := os.Getenv("ZERO_EXEC_TEST_DONE"); done != "" {
		_ = os.WriteFile(done, []byte(strconv.Itoa(os.Getpid())), 0o600)
	}
}

type stdioStream struct{}

func (stdioStream) Read(p []byte) (int, error)  { return os.Stdin.Read(p) }
func (stdioStream) Write(p []byte) (int, error) { return os.Stdout.Write(p) }
func (stdioStream) Close() error                { return os.Stdin.Close() }

func helper(t *testing.T, mode string, env ...string) Exec {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return Exec{Argv: []string{self}, Env: append(append(os.Environ(), helperEnv+"="+mode), env...)}
}

func get(t *testing.T, transport http.RoundTripper, method, path string) (*http.Response, error) {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), method, "http://localhost"+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	return transport.RoundTrip(request)
}

func text(t *testing.T, transport http.RoundTripper, path string) string {
	t.Helper()
	response, err := get(t, transport, http.MethodGet, path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestExecConnectsAndChecksTheServer(t *testing.T) {
	endpoint := helper(t, "serve")
	if endpoint.BaseURL() != "http://localhost" {
		t.Fatalf("BaseURL = %q", endpoint.BaseURL())
	}
	transport := endpoint.Transport()
	defer func() { _ = transport.Close() }()
	info, err := transport.Connect(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if info != (contract.RemoteInfo{Protocol: 1, Version: "test", Name: "helper"}) {
		t.Fatalf("info = %+v", info)
	}
	// Connect again reuses the running command.
	first := text(t, transport, "/pid")
	if _, err := transport.Connect(t.Context()); err != nil {
		t.Fatal(err)
	}
	if again := text(t, transport, "/pid"); again != first {
		t.Fatalf("pid changed from %s to %s without an exit", first, again)
	}
}

func TestExecStreamsEventsBesideOtherRequests(t *testing.T) {
	transport := helper(t, "serve").Transport()
	defer func() { _ = transport.Close() }()
	events, err := get(t, transport, http.MethodGet, "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = events.Body.Close() }()
	stream := bufio.NewReader(events.Body)
	if line, _ := stream.ReadString('\n'); line != ": ready\n" {
		t.Fatalf("first line = %q", line)
	}
	pid := text(t, transport, "/pid")
	for _, data := range []string{"one", "two"} {
		response, err := get(t, transport, http.MethodPost, "/emit?data="+data)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if line, _ := stream.ReadString('\n'); line != "data: "+data+"\n" {
			t.Fatalf("event = %q, want %s", line, data)
		}
	}
	if again := text(t, transport, "/pid"); again != pid {
		t.Fatalf("requests used two processes: %s and %s", pid, again)
	}
}

func TestExecStartsTheCommandAgainAfterItExits(t *testing.T) {
	transport := helper(t, "serve").Transport()
	defer func() { _ = transport.Close() }()
	first := text(t, transport, "/pid")
	if response, err := get(t, transport, http.MethodPost, "/exit"); err == nil {
		_ = response.Body.Close()
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		response, err := get(t, transport, http.MethodGet, "/pid")
		if err == nil {
			body, _ := io.ReadAll(response.Body)
			_ = response.Body.Close()
			if string(body) != first {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("no new process after the first (%s) exited: %v", first, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestExecCloseEndsTheCommandsInput(t *testing.T) {
	done := filepath.Join(t.TempDir(), "done")
	transport := helper(t, "serve", "ZERO_EXEC_TEST_DONE="+done).Transport()
	pid := text(t, transport, "/pid")
	if err := transport.Close(); err != nil {
		t.Fatal(err)
	}
	// Close waited for the exit; the helper wrote its pid on the way out, so
	// it saw the end of its input rather than being killed.
	got, err := os.ReadFile(done)
	if err != nil || string(got) != pid {
		t.Fatalf("done = %q, %v; want %s", got, err, pid)
	}
	if _, err := get(t, transport, http.MethodGet, "/pid"); !errors.Is(err, ErrClosed) {
		t.Fatalf("after Close: %v, want ErrClosed", err)
	}
}

func TestExecReportsWhatAFailingCommandSaid(t *testing.T) {
	transport := helper(t, "refuse").Transport()
	defer func() { _ = transport.Close() }()
	_, err := transport.Connect(t.Context())
	if err == nil || !strings.Contains(err.Error(), "No such container: gone") {
		t.Fatalf("Connect = %v", err)
	}
	missing := Exec{Argv: []string{filepath.Join(t.TempDir(), "missing")}}.Transport()
	if _, err := missing.Connect(t.Context()); err == nil || !strings.Contains(err.Error(), "start ") {
		t.Fatalf("Connect missing = %v", err)
	}
}
