package daemon

import (
	"sync"

	"github.com/flexdinesh/zero/internal/app"
	"github.com/flexdinesh/zero/pkg/contract"
)

// Exposure is one way the daemon offers its web app beyond its socket
// (decision 0126). It owns its listener and its UI lifetime; when it closes on
// its own, the daemon exits only if no exposure is listening and nothing else
// is active. Failures are *app.Error.
type Exposure interface {
	Status() contract.DaemonRemote
	// Start serves, or keeps serving, and restarts the wait for a UI.
	Start(request contract.DaemonRemoteRequest) (contract.DaemonRemote, error)
	// Stop closes the listener.
	Stop() contract.DaemonRemote
}

// exposure is an Exposure under its contract kind.
type exposure struct {
	kind string
	Exposure
}

// exposures serves one Exposure at a time: starting one stops the others,
// once it serves. It implements RemoteControl.
type exposures struct {
	mu   sync.Mutex
	list []exposure
	// tls rotates the identity; nil without one.
	tls *remoteServer
}

// add offers exposure under kind.
func (e *exposures) add(kind string, served Exposure) {
	e.list = append(e.list, exposure{kind: kind, Exposure: served})
}

// listening reports whether any exposure serves.
func (e *exposures) listening() bool {
	for _, exposure := range e.list {
		if exposure.Status().Listening {
			return true
		}
	}
	return false
}

// Status implements RemoteControl: the exposure serving, if any.
func (e *exposures) Status() contract.DaemonRemote {
	for _, exposure := range e.list {
		if status := exposure.Status(); status.Listening {
			status.Exposure = exposure.kind
			return status
		}
	}
	return contract.DaemonRemote{}
}

// Start implements RemoteControl.
func (e *exposures) Start(request contract.DaemonRemoteRequest) (contract.DaemonRemote, error) {
	kind := request.Exposure
	if kind == "" {
		kind = contract.RemoteExposureTLS
	}
	if kind != contract.RemoteExposureTLS && kind != contract.RemoteExposureTailscale {
		return contract.DaemonRemote{}, invalidRemote(`Exposure must be "tls" or "tailscale".`)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	var started *exposure
	for i := range e.list {
		if e.list[i].kind == kind {
			started = &e.list[i]
		}
	}
	if started == nil {
		message := "This daemon does not serve over TCP."
		if kind == contract.RemoteExposureTailscale {
			message = "This daemon does not serve over Tailscale."
		}
		return contract.DaemonRemote{}, &app.Error{Kind: contract.KindUnavailable, Code: contract.CodeRemoteUnavailable, Message: message}
	}
	status, err := started.Start(request)
	if err != nil {
		return contract.DaemonRemote{}, err
	}
	for _, other := range e.list {
		if other.kind != kind && other.Status().Listening {
			other.Stop()
		}
	}
	status.Exposure = kind
	return status, nil
}

// Stop implements RemoteControl: every exposure stops.
func (e *exposures) Stop() contract.DaemonRemote {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, exposure := range e.list {
		if exposure.Status().Listening {
			exposure.Stop()
		}
	}
	return contract.DaemonRemote{}
}

// Rotate implements RemoteControl. A TLS listener keeps its address.
func (e *exposures) Rotate() (contract.DaemonRemote, error) {
	if e.tls == nil {
		return contract.DaemonRemote{}, &app.Error{Kind: contract.KindUnavailable, Code: contract.CodeRemoteUnavailable, Message: "This daemon does not serve over TCP."}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	status, err := e.tls.Rotate()
	if err == nil && status.Listening {
		status.Exposure = contract.RemoteExposureTLS
	}
	return status, err
}
