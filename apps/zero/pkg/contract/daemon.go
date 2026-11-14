package contract

import "time"

// Daemon control (/_daemon/*, decisions 0061, 0066) error codes.
const (
	CodeBrowserRequest         = "browserRequest"
	CodeUnsupportedMediaType   = "unsupportedMediaType"
	CodeInvalidRequest         = "invalidRequest"
	CodeInvalidRoot            = "invalidRoot"
	CodeRootsNotSaved          = "rootsNotSaved"
	CodeProjectUnavailable     = "projectUnavailable"
	CodeWalkthroughUnavailable = "walkthroughUnavailable"
)

// DaemonFeedbackRequest is the body of POST /_daemon/feedback: announce that
// project's feedback ID changed, written by Author (decision 0120).
type DaemonFeedbackRequest struct {
	Project string         `json:"project"`
	ID      string         `json:"id"`
	Author  FeedbackAuthor `json:"author"`
}

// Remote serving (decision 0098) error codes.
const (
	// CodeUnauthorized: a TCP request without the connection string's token.
	CodeUnauthorized = "unauthorized"
	// CodePortBusy: the port asked for, or every default port, is taken.
	CodePortBusy = "portBusy"
	// CodeRemoteUnavailable: this daemon does not serve over TCP.
	CodeRemoteUnavailable = "remoteUnavailable"
	// CodeTailscaleUnavailable: Tailscale cannot serve here; the message
	// names the fix (decision 0126).
	CodeTailscaleUnavailable = "tailscaleUnavailable"
)

// Remote exposures (decision 0126): how the daemon serves beyond its socket.
// One serves at a time; starting another stops it.
const (
	// RemoteExposureTLS listens on TCP with pinned TLS and a token (0098).
	RemoteExposureTLS = "tls"
	// RemoteExposureTailscale is a foreground `tailscale serve` to a private
	// listener; the tailnet authenticates.
	RemoteExposureTailscale = "tailscale"
)

// RemoteInfoPath answers RemoteInfo over TCP, after authentication. The
// desktop app's pages cannot reach it: /_zero is refused there.
const RemoteInfoPath = "/_zero/remote"

// RemoteInfo describes a remote server to a client checking a connection
// string.
type RemoteInfo struct {
	Protocol int    `json:"protocol"`
	Version  string `json:"version"`
	// Name labels the connection: the machine's host name.
	Name string `json:"name"`
}

// DaemonRemoteRequest is the body of POST /_daemon/remote. Exposure is a
// RemoteExposure kind; empty is TLS. For TLS, an empty Host binds every
// interface and a nil Port tries the last port, then the default range. For
// Tailscale, Host must be empty and Port is the HTTPS port (default 7971). The
// durations (time.ParseDuration text) default to 10m and 5m.
type DaemonRemoteRequest struct {
	Exposure  string `json:"exposure,omitempty"`
	Host      string `json:"host,omitempty"`
	Port      *int   `json:"port,omitempty"`
	FirstWait string `json:"firstWait,omitempty"`
	Grace     string `json:"grace,omitempty"`
}

// DaemonRemote is the daemon's exposure, /_daemon/remote. Credential is a
// secret: only the Unix socket answers this. Clients is the UIs connected.
// Over Tailscale, Host is this machine's MagicDNS name, Port the HTTPS port,
// and there is no ID or Credential.
type DaemonRemote struct {
	Listening  bool   `json:"listening"`
	Exposure   string `json:"exposure,omitempty"`
	Host       string `json:"host,omitempty"`
	Port       int    `json:"port,omitempty"`
	ID         string `json:"id,omitempty"`
	Credential string `json:"credential,omitempty"`
	Clients    int    `json:"clients"`
}

// Daemon control stream event names, GET /_daemon/events.
const (
	DaemonEventStatus      = "status"
	DaemonEventWalkthrough = "walkthrough"
	// DaemonEventFeedback announces a feedback change (decision 0120). Its
	// body is FeedbackEvent; Project is the project it was written in.
	DaemonEventFeedback = "feedback"
)

// DaemonStatus describes a running daemon, GET /_daemon/status. Its shape
// is frozen across protocols.
type DaemonStatus struct {
	Protocol  int       `json:"protocol"`
	Version   string    `json:"version"`
	PID       int       `json:"pid"`
	Socket    string    `json:"socket"`
	Roots     []string  `json:"roots"`
	Depth     int       `json:"depth"`
	ScanDepth int       `json:"scanDepth"`
	IdleExit  string    `json:"idleExit"` // time.Duration.String(); "0s" never exits
	StartedAt time.Time `json:"startedAt"`
}

// DaemonRoots is GET /_daemon/roots: the served roots and the saved roots
// skipped at start.
type DaemonRoots struct {
	Roots   []string `json:"roots"`
	Skipped []string `json:"skipped"`
}

// DaemonPathRequest is the body of POST /_daemon/roots and /_daemon/open.
type DaemonPathRequest struct {
	Path string `json:"path"`
}

// DaemonOpenResult is POST /_daemon/open's answer, the same shape as POST
// /api/roots's.
type DaemonOpenResult = OpenedRoot

// DaemonStatusEvent is the control stream's first event.
type DaemonStatusEvent struct {
	Protocol int    `json:"protocol"`
	Version  string `json:"version"`
}

// WalkthroughEvent is the control stream's "walkthrough": a published
// walkthrough announcement.
type WalkthroughEvent struct {
	Project string `json:"project"`
	ID      string `json:"id"`
	Title   string `json:"title"`
	Created bool   `json:"created"`
}

// DaemonEvent is one control stream event: Name says which field is set.
type DaemonEvent struct {
	Name        string
	Status      *DaemonStatusEvent
	Walkthrough *WalkthroughEvent
	Feedback    *FeedbackEvent
}

// Payload is the event's body, encoded as the stream's data.
func (e DaemonEvent) Payload() any {
	switch e.Name {
	case DaemonEventStatus:
		return e.Status
	case DaemonEventWalkthrough:
		return e.Walkthrough
	case DaemonEventFeedback:
		return e.Feedback
	}
	return nil
}
