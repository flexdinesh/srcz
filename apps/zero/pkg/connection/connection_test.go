package connection

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func testCredential() Credential {
	var credential Credential
	for i := range credential.Fingerprint {
		credential.Fingerprint[i] = byte(i + 1)
	}
	for i := range credential.Token {
		credential.Token[i] = byte(200 - i)
	}
	return credential
}

func TestConnectionStringRoundTrips(t *testing.T) {
	for _, hosts := range [][]string{
		{"10.0.0.5"},
		{"10.0.0.5", "100.64.1.2"},
		{"box.tailnet.ts.net"},
		{"2001:db8::1"},
		{"10.0.0.5", "2001:db8::1"},
	} {
		endpoint := TLS{Hosts: hosts, Port: 7971, Credential: testCredential()}
		parsed, err := Parse(endpoint.Format())
		if err != nil {
			t.Fatalf("Parse(%q) = %v", endpoint.Format(), err)
		}
		if strings.Join(parsed.Hosts, " ") != strings.Join(hosts, " ") || parsed.Port != 7971 || parsed.Credential != endpoint.Credential {
			t.Errorf("Parse(%q) = %+v, want %+v", endpoint.Format(), parsed, endpoint)
		}
	}
}

// A pasted string must reach argv unchanged in bash, zsh, and fish.
func TestConnectionStringsAreShellSafe(t *testing.T) {
	safe := regexp.MustCompile(`^[A-Za-z0-9.,:/_-]+$`)
	plain := TLS{Hosts: []string{"10.0.0.5", "box.example.com"}, Port: 7971, Credential: testCredential()}
	if got := plain.Shell(); !safe.MatchString(got) || got != plain.Format() {
		t.Errorf("Shell() = %q has characters a shell would interpret", got)
	}
	bracketed := TLS{Hosts: []string{"2001:db8::1"}, Port: 7971, Credential: testCredential()}
	got := bracketed.Shell()
	if !strings.HasPrefix(got, "'[") || !strings.HasSuffix(got, "'") {
		t.Errorf("Shell() = %q, want an IPv6 string quoted against globbing", got)
	}
	if parsed, err := Parse(got); err != nil || parsed.Hosts[0] != "2001:db8::1" {
		t.Errorf("Parse(%q) = %+v, %v", got, parsed, err)
	}
}

func TestParseToleratesTerminalWrapping(t *testing.T) {
	endpoint := TLS{Hosts: []string{"10.0.0.5"}, Port: 7971, Credential: testCredential()}
	text := endpoint.Format()
	wrapped := "  " + text[:20] + "\n  " + text[20:] + "\n"
	if parsed, err := Parse(wrapped); err != nil || parsed.Credential != endpoint.Credential {
		t.Errorf("Parse(wrapped) = %+v, %v", parsed, err)
	}
}

func TestParseRejects(t *testing.T) {
	good := testCredential().Encode()
	for _, text := range []string{
		"",
		"10.0.0.5:7971",
		"10.0.0.5/" + good,
		"10.0.0.5:0/" + good,
		"10.0.0.5:70000/" + good,
		"10.0.0.5:07971/" + good,
		":7971/" + good,
		"10.0.0.5,:7971/" + good,
		"10.0.0.5:7971/short",
		"10.0.0.5:7971/" + good + "AAAA",
		"evil;rm:7971/" + good,
		"evil host:7971/" + good[:0] + "x",
		"[not-ip]:7971/" + good,
		"-flag:7971/" + good,
		"zero://10.0.0.5:7971/" + good,
		strings.Repeat("a,", maxHosts) + "a:7971/" + good,
	} {
		if parsed, err := Parse(text); !errors.Is(err, ErrInvalid) {
			t.Errorf("Parse(%q) = %+v, %v, want ErrInvalid", text, parsed, err)
		}
	}
}

func TestIDHoldsNoSecretAndIgnoresAddress(t *testing.T) {
	credential := testCredential()
	id := credential.ID()
	if !IsID(id) {
		t.Fatalf("ID() = %q is not an id", id)
	}
	if strings.Contains(id, credential.TokenText()) || strings.Contains(credential.Encode(), id) {
		t.Errorf("ID() = %q shares text with the secret", id)
	}
	other := credential
	other.Token[0]++
	if other.ID() != id {
		t.Errorf("ID depends on the token: %q and %q", other.ID(), id)
	}
	other = credential
	other.Fingerprint[0]++
	if other.ID() == id {
		t.Errorf("ID does not follow the fingerprint: both %q", id)
	}
	for _, text := range []string{Local, "r-", "r-ABCDEF012345", "r-abcdef01234", "r-abcdef0123456", "x-abcdef012345", "s-", "S-abcdef012345", "10.0.0.5:7971"} {
		if IsID(text) {
			t.Errorf("IsID(%q) = true", text)
		}
	}
}

func TestWebURLCarriesTheTokenOnly(t *testing.T) {
	endpoint := TLS{Hosts: []string{"2001:db8::1", "10.0.0.5"}, Port: 7971, Credential: testCredential()}
	got, err := endpoint.WebURL()
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://[2001:db8::1]:7971/?token=" + endpoint.Credential.TokenText(); got != want {
		t.Errorf("WebURL() = %q, want %q", got, want)
	}
}

func saved(id string) Saved {
	return Saved{ID: id, Label: "box", TLS: &SavedTLS{Hosts: []string{"10.0.0.5"}, Port: 7971, Credential: testCredential().Encode()}, AddedAt: time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)}
}

func TestStoreKeepsSecretsPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "connections.json")
	store := NewStore(path)
	if entries, err := store.List(); err != nil || len(entries) != 0 {
		t.Fatalf("List() on a missing file = %v, %v", entries, err)
	}
	if err := store.Put(saved("r-000000000001")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("file mode = %o, want 600", info.Mode().Perm())
	}
	directory, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if directory.Mode().Perm() != 0o700 {
		t.Errorf("directory mode = %o, want 700", directory.Mode().Perm())
	}
}

func TestStoreReplacesAndLooksUp(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err := store.Put(saved("r-000000000001")); err != nil {
		t.Fatal(err)
	}
	updated := saved("r-000000000001")
	updated.TLS.Hosts = []string{"100.64.1.2"}
	if err := store.Put(updated); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List()
	if err != nil || len(entries) != 1 {
		t.Fatalf("List() = %v, %v, want one entry", entries, err)
	}
	found, ok, err := store.Lookup("r-000000000001")
	if err != nil || !ok || found.TLS == nil || found.TLS.Hosts[0] != "100.64.1.2" {
		t.Errorf("Lookup() = %+v, %t, %v", found, ok, err)
	}
	if _, ok, err := store.Lookup("r-000000000002"); err != nil || ok {
		t.Errorf("Lookup(missing) = %t, %v", ok, err)
	}
	endpoint, err := found.TLS.Endpoint()
	if err != nil || endpoint.Credential != testCredential() || endpoint.Port != 7971 {
		t.Errorf("Endpoint() = %+v, %v", endpoint, err)
	}
}

func TestStoreKeepsConcurrentSaves(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "connections.json"))
	const writers = 16
	var group sync.WaitGroup
	failures := make(chan error, writers)
	for i := range writers {
		group.Go(func() {
			if err := store.Put(saved("r-" + strings.Repeat("0", 10) + strconv.Itoa(10+i))); err != nil {
				failures <- err
			}
		})
	}
	group.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	entries, err := store.List()
	if err != nil || len(entries) != writers {
		t.Errorf("List() has %d entries, %v, want %d", len(entries), err, writers)
	}
}

func TestStoreRefusesWhatItCannotRead(t *testing.T) {
	for name, content := range map[string]string{"malformed": "{", "future": `{"version": 99, "connections": []}`} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "connections.json")
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			store := NewStore(path)
			if _, err := store.List(); err == nil {
				t.Error("List() = nil error")
			}
			if err := store.Put(saved("r-000000000001")); err == nil {
				t.Error("Put() = nil error; it would overwrite the file")
			}
			after, err := os.ReadFile(path)
			if err != nil || string(after) != content {
				t.Errorf("the file changed to %q, %v", after, err)
			}
		})
	}
}

func TestSandboxIDHoldsNoInputsAndFollowsEach(t *testing.T) {
	id := SandboxID("docker", "engine-1", "3f2a9c1b7d4e")
	if !IsID(id) || !strings.HasPrefix(id, "s-") {
		t.Fatalf("SandboxID = %q is not a sandbox id", id)
	}
	if again := SandboxID("docker", "engine-1", "3f2a9c1b7d4e"); again != id {
		t.Errorf("SandboxID is not stable: %q and %q", again, id)
	}
	for _, other := range []string{
		SandboxID("podman", "engine-1", "3f2a9c1b7d4e"),
		SandboxID("docker", "engine-2", "3f2a9c1b7d4e"),
		SandboxID("docker", "engine-1", "3f2a9c1b7d4f"),
		// The separator keeps inputs apart.
		SandboxID("docker", "engine-13f2a9c1b7d4", "e"),
	} {
		if other == id {
			t.Errorf("SandboxID ignores an input: both %q", id)
		}
	}
}

func sandboxSaved() Saved {
	return Saved{ID: SandboxID("docker", "engine-1", "abc"), Label: "docker://web/src", Sandbox: &SavedSandbox{Provider: "docker", Ref: "abc", Path: "/src"}, AddedAt: time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)}
}

func TestStoreRoundTripsEveryKind(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connections.json")
	store := NewStore(path)
	want := []Saved{saved("r-000000000001"), sandboxSaved()}
	for _, entry := range want {
		if err := store.Put(entry); err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.List()
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("List() = %+v, %v, want %+v", got, err, want)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Version     int              `json:"version"`
		Connections []map[string]any `json:"connections"`
	}
	if err := json.Unmarshal(content, &document); err != nil {
		t.Fatal(err)
	}
	if document.Version != 2 || len(document.Connections) != 2 {
		t.Fatalf("file = %s", content)
	}
	if kind := document.Connections[0]["kind"]; kind != "tls" || document.Connections[0]["port"] != float64(7971) {
		t.Errorf("TLS entry = %v", document.Connections[0])
	}
	if entry := document.Connections[1]; entry["kind"] != "sandbox" || entry["provider"] != "docker" || entry["ref"] != "abc" || entry["path"] != "/src" || entry["hosts"] != nil {
		t.Errorf("sandbox entry = %v", entry)
	}
}

func TestStoreReadsVersion1AsTLSAndWritesVersion2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connections.json")
	v1 := `{"version": 1, "connections": [{"id": "r-000000000001", "label": "box", "hosts": ["10.0.0.5"], "port": 7971, "credential": "` + testCredential().Encode() + `", "addedAt": "2026-11-05T00:00:00Z"}]}`
	if err := os.WriteFile(path, []byte(v1), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	got, err := store.List()
	if err != nil || len(got) != 1 || !reflect.DeepEqual(got[0], saved("r-000000000001")) {
		t.Fatalf("List() = %+v, %v", got, err)
	}
	if err := store.Put(sandboxSaved()); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(content), `"version": 2`) || !strings.Contains(string(content), `"kind": "tls"`) {
		t.Fatalf("after Put the file is %s, %v", content, err)
	}
	if again, err := store.List(); err != nil || !reflect.DeepEqual(again, []Saved{saved("r-000000000001"), sandboxSaved()}) {
		t.Errorf("List() after Put = %+v, %v", again, err)
	}
}

func TestStoreKeepsKindsItDoesNotKnow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connections.json")
	future := `{"id":"t-000000000001","kind":"tailnet","label":"far","addedAt":"2026-11-05T00:00:00Z","node":"box.ts.net"}`
	if err := os.WriteFile(path, []byte(`{"version": 2, "connections": [`+future+`]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	found, ok, err := store.Lookup("t-000000000001")
	if err != nil || !ok || found.Kind() != "tailnet" || found.Label != "far" {
		t.Fatalf("Lookup() = %+v, %t, %v", found, ok, err)
	}
	if _, err := found.Endpoint("/bin/zero"); err == nil || !strings.Contains(err.Error(), "update zero") {
		t.Errorf("Endpoint() = %v, want an error asking to update", err)
	}
	if err := store.Put(saved("r-000000000001")); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(content), `"node": "box.ts.net"`) {
		t.Errorf("the unknown entry did not survive a save: %s, %v", content, err)
	}
}

func TestStoreRefusesEntriesWithoutAKind(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connections.json")
	if err := os.WriteFile(path, []byte(`{"version": 2, "connections": [{"id": "r-000000000001", "hosts": ["10.0.0.5"]}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(path).List(); err == nil {
		t.Error("List() = nil error")
	}
	if err := NewStore(filepath.Join(t.TempDir(), "connections.json")).Put(Saved{ID: "r-000000000001"}); err == nil {
		t.Error("Put(no kind) = nil error")
	}
}

func TestSavedEndpointPerKind(t *testing.T) {
	endpoint, err := saved("r-000000000001").Endpoint("/bin/zero")
	if tls, ok := endpoint.(TLS); err != nil || !ok || tls.Port != 7971 || tls.Credential != testCredential() {
		t.Errorf("TLS Endpoint() = %#v, %v", endpoint, err)
	}
	sandbox := sandboxSaved()
	endpoint, err = sandbox.Endpoint("/bin/zero")
	if exec, ok := endpoint.(Exec); err != nil || !ok || !reflect.DeepEqual(exec.Argv, []string{"/bin/zero", "connection", "stdio", sandbox.ID}) || exec.Env != nil {
		t.Errorf("sandbox Endpoint() = %#v, %v", endpoint, err)
	}
	if _, err := sandbox.Endpoint(""); err == nil {
		t.Error("sandbox Endpoint without zero = nil error")
	}
	broken := saved("r-000000000001")
	broken.TLS.Credential = "nope"
	if _, err := broken.Endpoint("/bin/zero"); err == nil {
		t.Error("Endpoint with a bad credential = nil error")
	}
}
