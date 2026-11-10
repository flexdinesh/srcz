package attach

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/flexdinesh/zero/internal/stdio"
	"github.com/flexdinesh/zero/pkg/contract"
)

// helperEnv makes the test binary play zero in the sandbox: a stdio server
// that answers /argv with its arguments and HOME.
const helperEnv = "ZERO_ATTACH_TEST_HELPER"

func TestMain(m *testing.M) {
	if os.Getenv(helperEnv) == "" {
		os.Exit(m.Run())
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /argv", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strings.Join(os.Args[1:], " ")+" HOME="+os.Getenv("HOME"))
	})
	_ = stdio.Serve(context.Background(), stdioStream{}, mux, contract.RemoteInfo{Protocol: 1, Version: "9.9.9", Name: "sandbox"})
	os.Exit(0)
}

type stdioStream struct{}

func (stdioStream) Read(p []byte) (int, error)  { return os.Stdin.Read(p) }
func (stdioStream) Write(p []byte) (int, error) { return os.Stdout.Write(p) }
func (stdioStream) Close() error                { return os.Stdin.Close() }

// fakeEnvironment runs "in the sandbox" as this test binary.
type fakeEnvironment struct {
	platform   string
	installErr error

	installed []string
}

func (f *fakeEnvironment) Platform(context.Context) (string, error) { return f.platform, nil }

func (f *fakeEnvironment) Install(_ context.Context, version string) (string, error) {
	f.installed = append(f.installed, version)
	return "/opt/sandbox/zero", f.installErr
}

func (f *fakeEnvironment) Exec(_ context.Context, argv, env []string) (*exec.Cmd, error) {
	self, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(self, argv...)
	cmd.Env = append(append(os.Environ(), helperEnv+"=1"), env...)
	return cmd, nil
}

func TestAttachInstallsAndServesThePathThere(t *testing.T) {
	env := &fakeEnvironment{platform: "linux/arm64"}
	endpoint, err := Attach(t.Context(), env, "/src", "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(env.installed, ",") != "1.2.3" {
		t.Fatalf("installed %q", env.installed)
	}
	transport := endpoint.Transport()
	defer func() { _ = transport.Close() }()
	info, err := transport.Connect(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "sandbox" || info.Version != "9.9.9" {
		t.Fatalf("info = %+v", info)
	}
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, endpoint.BaseURL()+"/argv", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(response.Body)
	if want := "/opt/sandbox/zero serve-stdio -- /src HOME=/opt/sandbox"; string(body) != want {
		t.Fatalf("ran %q, want %q", body, want)
	}
}

func TestAttachRefusesPlatformsWithoutABuild(t *testing.T) {
	env := &fakeEnvironment{platform: "linux/386"}
	_, err := Attach(t.Context(), env, ".", "1.2.3")
	if err == nil || !strings.Contains(err.Error(), "zero has no build for linux/386") {
		t.Fatalf("Attach = %v", err)
	}
	if len(env.installed) != 0 {
		t.Fatal("installed on an unsupported platform")
	}
}

func TestAttachReportsInstallFailures(t *testing.T) {
	failure := errors.New("no writable /tmp")
	_, err := Attach(t.Context(), &fakeEnvironment{platform: "linux/amd64", installErr: failure}, ".", "1.2.3")
	if !errors.Is(err, failure) {
		t.Fatalf("Attach = %v", err)
	}
}
