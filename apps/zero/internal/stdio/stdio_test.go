package stdio

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/flexdinesh/zero/pkg/contract"
)

// eventsHandler streams one event per /emit, and answers /hello.
func eventsHandler(emit chan string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /hello", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "hello "+r.Host)
	})
	mux.HandleFunc("POST /emit", func(w http.ResponseWriter, r *http.Request) {
		emit <- r.URL.Query().Get("data")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := http.NewResponseController(w)
		_, _ = io.WriteString(w, ": ready\n\n")
		_ = flusher.Flush()
		for {
			select {
			case data := <-emit:
				_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
				_ = flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})
	return mux
}

func dial(t *testing.T, conn net.Conn) *http.ClientConn {
	t.Helper()
	transport := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { return conn, nil }}
	transport.Protocols = new(http.Protocols)
	transport.Protocols.SetUnencryptedHTTP2(true)
	client, err := transport.NewClientConn(t.Context(), "http", "localhost:80")
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func send(t *testing.T, client *http.ClientConn, method, path string) *http.Response {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), method, "http://localhost"+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.RoundTrip(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return response
}

func readLine(t *testing.T, reader *bufio.Reader) string {
	t.Helper()
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(line)
}

func TestServeAnswersRequestsBesideAnOpenEventStream(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	info := contract.RemoteInfo{Protocol: 1, Version: "1.2.3", Name: "box"}
	served := make(chan error, 1)
	go func() { served <- Serve(t.Context(), serverSide, eventsHandler(make(chan string)), info) }()
	client := dial(t, clientSide)

	response := send(t, client, http.MethodGet, contract.RemoteInfoPath)
	var got contract.RemoteInfo
	if err := json.NewDecoder(response.Body).Decode(&got); err != nil || got != info {
		t.Fatalf("info = %+v, %v; want %+v", got, err, info)
	}
	_ = response.Body.Close()

	events := send(t, client, http.MethodGet, "/events")
	defer func() { _ = events.Body.Close() }()
	stream := bufio.NewReader(events.Body)
	if line := readLine(t, stream); line != ": ready" {
		t.Fatalf("first line = %q", line)
	}
	// Other requests share the connection while the stream stays open.
	hello := send(t, client, http.MethodGet, "/hello")
	body, _ := io.ReadAll(hello.Body)
	_ = hello.Body.Close()
	if string(body) != "hello localhost" {
		t.Fatalf("hello = %q", body)
	}
	for _, data := range []string{"one", "two"} {
		emitted := send(t, client, http.MethodPost, "/emit?data="+data)
		_ = emitted.Body.Close()
		readLine(t, stream) // blank line or the previous event's end
		if line := readLine(t, stream); line != "data: "+data {
			t.Fatalf("event = %q, want data: %s", line, data)
		}
	}

	// The peer closing its end stops serving.
	_ = client.Close()
	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("Serve = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return after the peer closed")
	}
}

func TestServeStopsWhenContextEnds(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer func() { _ = clientSide.Close() }()
	ctx, cancel := context.WithCancel(t.Context())
	served := make(chan error, 1)
	go func() { served <- Serve(ctx, serverSide, http.NotFoundHandler(), contract.RemoteInfo{Protocol: 1}) }()
	cancel()
	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("Serve = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return after ctx ended")
	}
}

func TestServeRefusesWritesToInfo(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	go func() { _ = Serve(t.Context(), serverSide, http.NotFoundHandler(), contract.RemoteInfo{Protocol: 1}) }()
	client := dial(t, clientSide)
	defer func() { _ = client.Close() }()
	response := send(t, client, http.MethodPost, contract.RemoteInfoPath)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", response.StatusCode)
	}
}
