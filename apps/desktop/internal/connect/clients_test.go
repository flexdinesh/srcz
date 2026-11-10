package connect

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/flexdinesh/zero/apps/desktop/internal/notifier"
	"github.com/flexdinesh/zero/pkg/client"
	"github.com/flexdinesh/zero/pkg/connection"
)

func TestStreamClientKeepsItsClientAndEnsuresWhenTheDaemonHasGone(t *testing.T) {
	socket := "/run/one.sock"
	ensures := 0
	daemon := NewDaemon("zero", nil, nil, func(context.Context, string, ...string) ([]byte, []byte, error) {
		ensures++
		return []byte(fmt.Sprintf(`{"protocol":1,"version":"x","pid":1,"socket":%q,"roots":[],"depth":0,"scanDepth":0,"idleExit":"30m0s","startedAt":"2026-11-03T10:00:00Z"}`, socket)), nil, nil
	})
	first, err := daemon.StreamClient(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	again, err := daemon.StreamClient(context.Background(), errors.New("the stream was reset"))
	if err != nil {
		t.Fatal(err)
	}
	if first != again || ensures != 1 {
		t.Errorf("another failure: same client %v, %d ensures", first == again, ensures)
	}

	socket = "/run/two.sock"
	gone, err := daemon.StreamClient(context.Background(), goneError(t))
	if err != nil {
		t.Fatal(err)
	}
	if gone == first || ensures != 2 {
		t.Errorf("a gone daemon: same client %v, %d ensures", gone == first, ensures)
	}
}

// goneError is what a request answers when the daemon's socket is dead.
func goneError(t *testing.T) error {
	t.Helper()
	dead := client.NewUnix(t.TempDir() + "/dead.sock")
	_, err := dead.DaemonStatus(context.Background())
	if !IsGone(err) {
		t.Fatalf("a dead socket's error %v is not gone", err)
	}
	return err
}

// endpoints serves saved connections by id; err fails every lookup.
type endpoints struct {
	saved map[string]connection.Endpoint
	err   error
}

func (e *endpoints) Endpoint(id string) (connection.Endpoint, bool, error) {
	if e.err != nil {
		return nil, false, e.err
	}
	endpoint, found := e.saved[id]
	return endpoint, found, nil
}

// named answers /api/projects with one root, its name.
func named(t *testing.T, name string) connection.Endpoint {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"roots":[{"path":"/`+name+`","name":"`+name+`"}],"projects":[]}`)
	}))
	t.Cleanup(server.Close)
	return httpEndpoint(server.URL)
}

// httpEndpoint is a plain HTTP server.
type httpEndpoint string

func (e httpEndpoint) BaseURL() string               { return string(e) }
func (httpEndpoint) RoundTripper() http.RoundTripper { return &http.Transport{} }

func TestRemoteClientsFollowTheSavedConnection(t *testing.T) {
	const id = "s-0123456789ab"
	saved := &endpoints{saved: map[string]connection.Endpoint{id: named(t, "first")}}
	connect := RemoteClients(saved, id)
	root := func() string {
		t.Helper()
		reached, err := connect(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		projects, err := reached.Projects(context.Background())
		if err != nil || len(projects.Roots) != 1 {
			t.Fatalf("Projects = %+v, %v", projects, err)
		}
		return projects.Roots[0].Name
	}
	if got := root(); got != "first" {
		t.Fatalf("reached %q", got)
	}

	// A changed connection applies to the next attempt.
	saved.saved[id] = named(t, "second")
	if got := root(); got != "second" {
		t.Errorf("after a change, reached %q", got)
	}

	delete(saved.saved, id)
	if _, err := connect(context.Background(), nil); !errors.Is(err, notifier.ErrNoConnection) {
		t.Errorf("a forgotten connection: %v", err)
	}
	saved.err = io.ErrUnexpectedEOF
	if _, err := connect(context.Background(), nil); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Errorf("an unreadable store: %v", err)
	}
}
