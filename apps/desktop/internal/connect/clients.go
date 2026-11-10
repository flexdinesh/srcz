package connect

import (
	"context"

	"github.com/flexdinesh/zero/apps/desktop/internal/notifier"
	"github.com/flexdinesh/zero/pkg/client"
	"github.com/flexdinesh/zero/pkg/connection"
)

// StreamClient returns a client for the long-lived streams of a notifier: the
// same client while the socket stands, since each opens idle connections of its
// own. failed is why the last stream ended; when the daemon has gone, as after
// its idle exit, it ensures again, as the page's requests do.
func (d *Daemon) StreamClient(ctx context.Context, failed error) (client.Client, error) {
	var (
		socket string
		err    error
	)
	if IsGone(failed) {
		socket, err = d.Reensure(ctx)
	} else {
		socket, err = d.Socket(ctx, false)
	}
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.streamClient == nil || d.streamSocket != socket {
		d.streamClient, d.streamSocket = client.NewUnix(socket), socket
	}
	return d.streamClient, nil
}

// Endpoints reaches saved connections' servers.
type Endpoints interface {
	// Endpoint is id's server, rereading the saved connection; found is false
	// when id is not saved.
	Endpoint(id string) (endpoint connection.Endpoint, found bool, err error)
}

// RemoteClients returns what a notifier connects to a saved server with: a
// client over the transport the window's pages use, so a sandbox runs one zero
// for both. Each attempt rereads the saved connection, so `zero connect` with
// new addresses applies to the next one.
func RemoteClients(endpoints Endpoints, id string) func(context.Context, error) (client.Client, error) {
	return func(context.Context, error) (client.Client, error) {
		endpoint, found, err := endpoints.Endpoint(id)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, notifier.ErrNoConnection
		}
		return client.NewEndpoint(endpoint), nil
	}
}
