//go:build linux || darwin

package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// This opt-in test drives the real Docker daemon with the committed
// compose.yaml: concurrent projects stay isolated, the host is unreachable,
// and tearing down one project leaves the other running.
func TestComposeIsolationAcceptance(t *testing.T) {
	if os.Getenv("ZERO_COMPOSE_ACCEPTANCE") != "1" {
		t.Skip("set ZERO_COMPOSE_ACCEPTANCE=1 with a local Docker daemon")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	root := t.TempDir()
	probe := filepath.Join(root, "image", "probe")
	if err := os.MkdirAll(filepath.Dir(probe), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "probe.go"), []byte(isolationProbe), 0600); err != nil {
		t.Fatal(err)
	}
	build := exec.CommandContext(ctx, "go", "build", "-o", probe, filepath.Join(root, "probe.go"))
	build.Env = append(os.Environ(), "GOOS=linux", "GOARCH=amd64", "CGO_ENABLED=0", "GOWORK=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build probe: %v\n%s", err, output)
	}
	dockerfile := "FROM debian:bookworm-slim@sha256:a3bba7dc7dbcc1f37c2856c51fc9a7fac96608f50cb87b1b4e4d8b8c85ae988e\nCOPY probe /probe\n"
	if err := os.WriteFile(filepath.Join(root, "image", "Dockerfile"), []byte(dockerfile), 0600); err != nil {
		t.Fatal(err)
	}
	d := dockerCLI{}
	idFile := filepath.Join(root, "image.id")
	var buildLog bytes.Buffer
	if err := d.run(ctx, nil, &buildLog, nil, "buildx", "build", "--builder", "default", "--load", "--iidfile", idFile, filepath.Join(root, "image")); err != nil {
		t.Fatalf("build image: %v\n%s", err, buildLog.String())
	}
	raw, err := os.ReadFile(idFile)
	if err != nil {
		t.Fatal(err)
	}
	image := strings.TrimSpace(string(raw))
	t.Cleanup(func() { _, _ = d.output(context.Background(), "image", "rm", image) })

	// Every context directory carries the committed compose file.
	contexts := filepath.Join(root, "ctx")
	composeFile, err := os.ReadFile("compose.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(contexts, "ctx-src", "tools", "validate"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(contexts, "ctx-src", "tools", "validate", "compose.yaml"), composeFile, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := d.output(ctx, "volume", "create", "--label", "io.zero.validation=cache", goBuildVolume); err != nil {
		t.Fatal(err)
	}

	var hostRequests atomic.Int32
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	host := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hostRequests.Add(1)
		fmt.Fprint(w, "host-must-not-answer")
	})}
	go func() { _ = host.Serve(listener) }()
	defer host.Close()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatal("host listener has no TCP address")
	}
	hostPort := fmt.Sprint(address.Port)

	jobs := map[string]containerJob{}
	for i, group := range []string{"acceptance-a", "acceptance-b", "acceptance-c"} {
		jobs[group] = containerJob{Docker: d, Slot: 90 + i, Group: group, Attempt: newID(), Contexts: contexts}
		job := jobs[group]
		t.Cleanup(func() { _ = job.teardown(context.Background()) })
	}
	runProbe := func(ctx context.Context, job containerJob, out *probeOutput, args ...string) error {
		argv := job.composeArgs(append([]string{"run", "--no-TTY", "--name", projectName(job.Slot, job.Group) + "-runner", "runner", "/probe"}, args...)...)
		return d.run(ctx, job.composeEnvironment(image), out, nil, argv...)
	}

	isolated := &probeOutput{}
	if err := runProbe(ctx, jobs["acceptance-c"], isolated, "missing", hostPort); err != nil {
		t.Fatalf("isolation probe: %v\n%s", err, isolated.String())
	}
	if !strings.Contains(isolated.String(), "ISOLATED") || hostRequests.Load() != 0 {
		t.Fatalf("runner reached the host or the internet: %s", isolated.String())
	}
	if err := jobs["acceptance-c"].teardown(ctx); err != nil {
		t.Fatal(err)
	}

	firstID, secondID := newID(), newID()
	first := &probeOutput{ready: make(chan struct{}), marker: "READY:" + firstID}
	second := &probeOutput{ready: make(chan struct{}), marker: "READY:" + secondID}
	firstCtx, stopFirst := context.WithCancel(ctx)
	defer stopFirst()
	firstDone, secondDone := make(chan error, 1), make(chan error, 1)
	go func() { firstDone <- runProbe(firstCtx, jobs["acceptance-a"], first, "serve", firstID, "120") }()
	go func() { secondDone <- runProbe(ctx, jobs["acceptance-b"], second, "serve", secondID, "8") }()
	for _, output := range []*probeOutput{first, second} {
		select {
		case <-output.ready:
		case <-ctx.Done():
			t.Fatalf("probe never ready: %s", output.String())
		}
	}
	// Both listen on the same container port without conflict; now tear down
	// the first while the second still runs.
	stopFirst()
	<-firstDone
	if err := jobs["acceptance-a"].teardown(context.Background()); err != nil {
		t.Fatal(err)
	}
	remaining, err := d.output(ctx, "ps", "--all", "--quiet", "--filter", "label="+composeLabel+"="+projectName(90, "acceptance-a"))
	if err != nil || strings.TrimSpace(remaining) != "" {
		t.Fatalf("torn-down project left containers: %q %v", remaining, err)
	}
	if err := <-secondDone; err != nil || !strings.Contains(second.String(), "RESULT:"+secondID) {
		t.Fatalf("other project affected by teardown: %v\n%s", err, second.String())
	}
	if hostRequests.Load() != 0 {
		t.Fatal("host received a runner request")
	}
	if err := jobs["acceptance-b"].teardown(ctx); err != nil {
		t.Fatal(err)
	}
	networks, err := d.output(ctx, "network", "ls", "--quiet", "--filter", "label="+composeLabel+"="+projectName(91, "acceptance-b"))
	if err != nil || strings.TrimSpace(networks) != "" {
		t.Fatalf("project network left behind: %q %v", networks, err)
	}
	if _, err := d.output(ctx, "volume", "inspect", goBuildVolume); err != nil {
		t.Fatal("teardown removed the shared external cache volume")
	}
}

type probeOutput struct {
	mu     sync.Mutex
	buffer bytes.Buffer
	ready  chan struct{}
	marker string
	once   sync.Once
}

func (o *probeOutput) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	n, err := o.buffer.Write(p)
	if o.ready != nil && strings.Contains(o.buffer.String(), o.marker) {
		o.once.Do(func() { close(o.ready) })
	}
	return n, err
}

func (o *probeOutput) String() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.buffer.String()
}

const isolationProbe = `package main

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func gateways() []string {
	out := []string{"127.0.0.1", "172.17.0.1", "host.docker.internal"}
	file, err := os.Open("/proc/net/route")
	if err != nil {
		return out
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) > 2 && fields[1] == "00000000" {
			value, err := strconv.ParseUint(fields[2], 16, 32)
			if err == nil {
				out = append(out, fmt.Sprintf("%d.%d.%d.%d", byte(value), byte(value>>8), byte(value>>16), byte(value>>24)))
			}
		}
	}
	return out
}

func main() {
	client := http.Client{Timeout: 2 * time.Second}
	switch os.Args[1] {
	case "missing":
		for _, host := range gateways() {
			if response, err := client.Get("http://" + net.JoinHostPort(host, os.Args[2])); err == nil {
				response.Body.Close()
				fmt.Println("REACHED", host)
				os.Exit(1)
			}
		}
		if conn, err := net.DialTimeout("tcp", "1.1.1.1:443", 2*time.Second); err == nil {
			conn.Close()
			fmt.Println("REACHED internet")
			os.Exit(1)
		}
		fmt.Println("ISOLATED")
	case "serve":
		listener, err := net.Listen("tcp", "127.0.0.1:18090")
		if err != nil {
			panic(err)
		}
		go http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, os.Args[2]) }))
		fmt.Println("READY:" + os.Args[2])
		seconds, _ := strconv.Atoi(os.Args[3])
		time.Sleep(time.Duration(seconds) * time.Second)
		response, err := client.Get("http://127.0.0.1:18090")
		if err != nil {
			panic(err)
		}
		defer response.Body.Close()
		body := make([]byte, 64)
		n, _ := response.Body.Read(body)
		if string(body[:n]) != os.Args[2] {
			panic("another runner answered")
		}
		fmt.Println("RESULT:" + os.Args[2])
	}
}
`
