package connection

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"time"
)

const (
	// storeVersion is what Put writes. Version 1 held TLS connections only,
	// without a kind; List reads it as TLS.
	storeVersion = 2
	// lockWait bounds waiting for another process's save.
	lockWait = 2 * time.Second
	// lockStale is when a lock's owner is presumed dead: saves take
	// milliseconds.
	lockStale = 10 * time.Second
)

// Kinds of saved connection: the "kind" of each entry in the file.
const (
	KindTLS     = "tls"
	KindSandbox = "sandbox"
)

// Saved is a saved connection: its id and label, and exactly one kind, TLS or
// Sandbox. An entry of a kind this build does not know is kept as written, so
// a newer zero's connections survive an older one's saves; it has no endpoint.
type Saved struct {
	ID      string
	Label   string
	AddedAt time.Time
	// TLS is a remote server paired by `zero connect` (decision 0098).
	TLS *SavedTLS
	// Sandbox is a sandbox `zero attach` saved (decision 0128).
	Sandbox *SavedSandbox

	// kind and raw are an entry of another kind, as read.
	kind string
	raw  json.RawMessage
}

// SavedTLS is a remote server over pinned TLS. Credential is a secret; the
// file holding it is private to the user.
type SavedTLS struct {
	Hosts      []string `json:"hosts"`
	Port       int      `json:"port"`
	Credential string   `json:"credential"`
}

// SavedSandbox is a sandbox zero runs in. Provider and Ref are the CLI's:
// only `zero connection stdio` reads them.
type SavedSandbox struct {
	// Provider is a sandbox provider, such as docker.
	Provider string `json:"provider"`
	// Ref names the sandbox to its provider, such as a container ID.
	Ref string `json:"ref"`
	// Path is the directory served there: absolute, or "." for the
	// sandbox's working directory.
	Path string `json:"path"`
}

// Kind is the entry's kind.
func (s Saved) Kind() string {
	switch {
	case s.TLS != nil:
		return KindTLS
	case s.Sandbox != nil:
		return KindSandbox
	}
	return s.kind
}

// Endpoint is how to reach the saved server. zero is the zero binary that
// serves a sandbox connection: `zero connection stdio <id>` runs there.
func (s Saved) Endpoint(zero string) (Endpoint, error) {
	switch {
	case s.TLS != nil:
		return s.TLS.Endpoint()
	case s.Sandbox != nil:
		if zero == "" {
			return nil, errors.New("no zero binary to run this sandbox connection")
		}
		return Exec{Argv: []string{zero, "connection", "stdio", s.ID}}, nil
	}
	return nil, fmt.Errorf("connection %s is a %q connection, which this zero does not know: update zero", s.ID, s.kind)
}

// Endpoint is how to reach the server.
func (s SavedTLS) Endpoint() (TLS, error) {
	credential, err := ParseCredential(s.Credential)
	if err != nil {
		return TLS{}, err
	}
	return TLS{Hosts: s.Hosts, Port: s.Port, Credential: credential}, nil
}

// savedHeader is what every kind's entry has.
type savedHeader struct {
	ID      string    `json:"id"`
	Kind    string    `json:"kind"`
	Label   string    `json:"label"`
	AddedAt time.Time `json:"addedAt"`
}

// MarshalJSON writes the entry flat: the header and its kind's fields.
func (s Saved) MarshalJSON() ([]byte, error) {
	header := savedHeader{ID: s.ID, Kind: s.Kind(), Label: s.Label, AddedAt: s.AddedAt}
	switch {
	case s.TLS != nil && s.Sandbox != nil:
		return nil, fmt.Errorf("connection %s has two kinds", s.ID)
	case s.TLS != nil:
		return json.Marshal(struct {
			savedHeader
			SavedTLS
		}{header, *s.TLS})
	case s.Sandbox != nil:
		return json.Marshal(struct {
			savedHeader
			SavedSandbox
		}{header, *s.Sandbox})
	case s.raw != nil:
		return s.raw, nil
	}
	return nil, fmt.Errorf("connection %s has no kind", s.ID)
}

// UnmarshalJSON reads a version 2 entry.
func (s *Saved) UnmarshalJSON(data []byte) error {
	var header savedHeader
	if err := json.Unmarshal(data, &header); err != nil {
		return err
	}
	*s = Saved{ID: header.ID, Label: header.Label, AddedAt: header.AddedAt}
	switch header.Kind {
	case KindTLS:
		s.TLS = &SavedTLS{}
		return json.Unmarshal(data, s.TLS)
	case KindSandbox:
		s.Sandbox = &SavedSandbox{}
		return json.Unmarshal(data, s.Sandbox)
	case "":
		return fmt.Errorf("connection %s has no kind", header.ID)
	}
	s.kind, s.raw = header.Kind, append(json.RawMessage(nil), data...)
	return nil
}

// readV1 reads a version 1 entry: TLS, with no kind.
func readV1(data []byte) (Saved, error) {
	var entry struct {
		savedHeader
		SavedTLS
	}
	if err := json.Unmarshal(data, &entry); err != nil {
		return Saved{}, err
	}
	return Saved{ID: entry.ID, Label: entry.Label, AddedAt: entry.AddedAt, TLS: &entry.SavedTLS}, nil
}

type storeDocument struct {
	Version     int     `json:"version"`
	Connections []Saved `json:"connections"`
}

// Store is the saved connections. `zero connect` writes it and the desktop
// app reads it, so a link can name a connection without carrying its secret.
type Store struct{ path string }

// DefaultStorePath is os.UserConfigDir()/zero/connections.json.
func DefaultStorePath() (string, error) {
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("locate user config: %w", err)
	}
	return filepath.Join(directory, "zero", "connections.json"), nil
}

// NewStore returns the store at path.
func NewStore(path string) Store { return Store{path: path} }

// List returns the saved connections; a missing file is an empty list. A
// malformed file or an unknown version is an error, so saves never overwrite
// what this build cannot read.
func (s Store) List() ([]Saved, error) {
	content, err := os.ReadFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read connections: %w", err)
	}
	var document struct {
		Version     int               `json:"version"`
		Connections []json.RawMessage `json:"connections"`
	}
	if err := json.Unmarshal(content, &document); err != nil {
		return nil, fmt.Errorf("connections file %s is malformed: %w", s.path, err)
	}
	if document.Version != 1 && document.Version != storeVersion {
		return nil, fmt.Errorf("connections file %s has version %d; this zero reads versions 1 and %d", s.path, document.Version, storeVersion)
	}
	saved := make([]Saved, 0, len(document.Connections))
	for _, data := range document.Connections {
		var entry Saved
		var err error
		if document.Version == 1 {
			entry, err = readV1(data)
		} else {
			err = json.Unmarshal(data, &entry)
		}
		if err != nil {
			return nil, fmt.Errorf("connections file %s is malformed: %w", s.path, err)
		}
		saved = append(saved, entry)
	}
	return saved, nil
}

// Lookup finds a saved connection by id.
func (s Store) Lookup(id string) (Saved, bool, error) {
	saved, err := s.List()
	if err != nil {
		return Saved{}, false, err
	}
	index := slices.IndexFunc(saved, func(entry Saved) bool { return entry.ID == id })
	if index < 0 {
		return Saved{}, false, nil
	}
	return saved[index], true, nil
}

// Put saves a connection, replacing one with its id. Concurrent saves from
// other processes do not lose each other's entries.
func (s Store) Put(entry Saved) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create connections directory: %w", err)
	}
	unlock, err := s.lock()
	if err != nil {
		return err
	}
	defer unlock()
	saved, err := s.List()
	if err != nil {
		return err
	}
	saved = slices.DeleteFunc(saved, func(existing Saved) bool { return existing.ID == entry.ID })
	return s.write(append(saved, entry))
}

func (s Store) write(saved []Saved) error {
	content, err := json.MarshalIndent(storeDocument{Version: storeVersion, Connections: saved}, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".connections-*")
	if err != nil {
		return fmt.Errorf("write connections: %w", err)
	}
	defer func() { _ = os.Remove(temporary.Name()) }()
	// CreateTemp's file is 0600, so the secret is never briefly world-readable.
	if _, err := temporary.Write(append(content, '\n')); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write connections: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("write connections: %w", err)
	}
	if err := os.Rename(temporary.Name(), s.path); err != nil {
		return fmt.Errorf("write connections: %w", err)
	}
	return nil
}

// lock takes a lock file, portably: O_EXCL works on every platform the CLI
// builds for. A lock older than lockStale is presumed abandoned.
func (s Store) lock() (func(), error) {
	path := s.path + ".lock"
	deadline := time.Now().Add(lockWait)
	for {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			_ = file.Close()
			return func() { _ = os.Remove(path) }, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, fmt.Errorf("lock connections: %w", err)
		}
		if info, err := os.Stat(path); err == nil && time.Since(info.ModTime()) > lockStale {
			_ = os.Remove(path)
			continue
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("lock connections: %s is held", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
