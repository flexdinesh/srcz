package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"time"

	"github.com/fatih/color"
	"github.com/flexdinesh/zero/internal/attach"
	"github.com/flexdinesh/zero/internal/browser"
	"github.com/flexdinesh/zero/internal/daemon"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/internal/runtime"
	"github.com/flexdinesh/zero/internal/sandbox"
	"github.com/flexdinesh/zero/internal/stdio"
	"github.com/flexdinesh/zero/internal/version"
	"github.com/flexdinesh/zero/pkg/contract"
	"github.com/spf13/cobra"
)

// attachHost is where `zero attach` serves the browser: this machine only.
const attachHost = "127.0.0.1"

type attachOptions struct {
	target  string
	port    int
	portSet bool
	noOpen  bool
}

// newAttachCommand builds `zero attach <target>` (decision 0127).
func newAttachCommand(runAttach func(context.Context, attachOptions, io.Writer, io.Writer) error) *cobra.Command {
	var opts attachOptions
	command := &cobra.Command{
		Use:   "attach <target>",
		Short: "Browse files in a running container in a web browser",
		Long: "Browse files in a running container in a web browser.\n" +
			"The target is docker://<container>[/path]; without a path, zero serves the container's working directory.\n" +
			"zero copies itself into the container's /tmp/.zero, and removes that copy when it stops.",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			if opts.port < 0 || opts.port > 65535 {
				return errors.New("--port must be between 0 and 65535")
			}
			opts.target = args[0]
			opts.portSet = command.Flags().Changed("port")
			return runAttach(command.Context(), opts, command.OutOrStdout(), command.ErrOrStderr())
		},
	}
	flags := command.Flags()
	flags.IntVar(&opts.port, "port", 0, "port (0 asks the OS); defaults to the first free port from 7971 to 7980")
	flags.BoolVar(&opts.noOpen, "no-open", false, "do not open the browser automatically")
	return command
}

// runAttach installs zero in the target, runs it there, and serves it to the
// browser on attachHost until ctx ends.
func runAttach(ctx context.Context, opts attachOptions, stdout, stderr io.Writer) error {
	target, err := sandbox.ParseTarget(opts.target)
	if err != nil {
		return err
	}
	output := terminalWriter(stdout)
	label := color.New(color.Faint)
	_, _ = fmt.Fprint(output, "  ")
	_, _ = label.Fprintf(output, "installing zero in %s\n", opts.target)
	endpoint, err := attach.Attach(ctx, target.Environment, target.Path, version.Number())
	if err != nil {
		return err
	}
	transport := endpoint.Transport()
	defer func() { _ = transport.Close() }()
	info, err := transport.Connect(ctx)
	if err != nil {
		return err
	}
	proxy, err := attachProxy(endpoint.BaseURL(), transport)
	if err != nil {
		return err
	}

	listener, err := openListener(attachHost, options{port: opts.port, portSet: opts.portSet}, stdout, listen)
	if errors.Is(err, errDefaultPortsBusy) {
		return fmt.Errorf("ports %d to %d are busy: pass --port", defaultPortStart, defaultPortEnd)
	}
	if err != nil {
		return fmt.Errorf("listen on %s: %w", attachHost, err)
	}
	port, err := listenerPort(listener.Addr())
	if err != nil {
		_ = listener.Close()
		return err
	}
	link := serverURL(attachHost, port)
	writeAttachStartup(stdout, opts.target, info, hyperlink(link, linkTerminal(stdout, os.Getenv)))
	if shouldOpenBrowser(opts.noOpen, goruntime.GOOS, os.Getenv) {
		go func() {
			if err := browser.Open(link); err != nil {
				_, _ = fmt.Fprintf(stderr, "  could not open browser: %v\n", err)
			}
		}()
	}
	return serveAttached(ctx, listener, proxy, transport)
}

func writeAttachStartup(stdout io.Writer, target string, info contract.RemoteInfo, link string) {
	output := terminalWriter(stdout)
	heading := color.New(color.Bold, color.FgHiMagenta)
	label := color.New(color.Faint)
	_, _ = fmt.Fprint(output, "  ")
	_, _ = heading.Fprintln(output, "zero "+version.Number())
	writeStartupValue(output, label, color.New(color.FgHiBlue), "attached to:  ", fmt.Sprintf("%s (zero %s on %s)", target, info.Version, info.Name))
	writeStartupValue(output, label, color.New(color.FgHiCyan, color.Underline), "web:          ", link)
	_, _ = fmt.Fprintln(output)
	_, _ = fmt.Fprint(output, "  ")
	_, _ = label.Fprintln(output, "ctrl-c to stop.")
}

// attachProxy forwards the browser's requests to zero in the sandbox. They
// keep the browser's Host, so the web app's Host check and same-origin
// guards see this machine's address, as with `zero browser`.
func attachProxy(base string, transport http.RoundTripper) (http.Handler, error) {
	target, err := url.Parse(base)
	if err != nil {
		return nil, err
	}
	return &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(target)
			request.Out.Host = request.In.Host
		},
		Transport: transport,
		// Streams cut by a stop are expected, not news.
		ErrorLog: log.New(io.Discard, "", 0),
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			http.Error(w, "zero in the sandbox did not answer: "+err.Error(), http.StatusBadGateway)
		},
	}, nil
}

// serveAttached serves handler until ctx ends. Closing transport first ends
// the event streams, which would otherwise hold shutdown.
func serveAttached(ctx context.Context, listener net.Listener, handler http.Handler, transport io.Closer) error {
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	select {
	case err := <-served:
		return fmt.Errorf("serve files: %w", err)
	case <-ctx.Done():
	}
	_ = transport.Close()
	shutdown, cancel := context.WithTimeout(context.Background(), runtime.ShutdownTimeout)
	defer cancel()
	err := server.Shutdown(shutdown)
	<-served
	if err != nil {
		return fmt.Errorf("stop local server: %w", err)
	}
	return nil
}

// newServeStdioCommand builds the hidden `zero serve-stdio <path>`, which
// `zero attach` runs in a sandbox: the web app on standard input and output.
func newServeStdioCommand() *cobra.Command {
	return &cobra.Command{
		Use:           "serve-stdio <path>",
		Short:         "Serve a directory on standard input and output",
		Hidden:        true,
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			wire := stdioWire{in: os.Stdin, out: os.Stdout}
			// Only the wire writes to standard output.
			os.Stdout = os.Stderr
			err := serveStdio(command.Context(), args[0], wire)
			removeAttachedBinary()
			return err
		},
	}
}

func serveStdio(ctx context.Context, dir string, wire io.ReadWriteCloser) error {
	roots, err := projects.NewRootSet([]string{dir})
	if err != nil {
		return err
	}
	rt, err := runtime.New(runtime.Config{Roots: roots, Depth: defaultDepth, ScanDepth: defaultScanDepth})
	if err != nil {
		return err
	}
	defer rt.Close()
	name, err := os.Hostname()
	if err != nil {
		name = "zero"
	}
	info := contract.RemoteInfo{Protocol: daemon.ProtocolVersion, Version: version.Number(), Name: name}
	return stdio.Serve(ctx, wire, rt.Handler(), info)
}

// removeAttachedBinary deletes this binary when `zero attach` installed it:
// nothing of zero but its HOME stays in the sandbox.
func removeAttachedBinary() {
	self, err := os.Executable()
	if err == nil && filepath.Dir(self) == sandbox.InstallDir {
		_ = os.Remove(self)
	}
}

// stdioWire is this process's standard input and output as one stream.
type stdioWire struct {
	in  *os.File
	out *os.File
}

func (w stdioWire) Read(p []byte) (int, error)  { return w.in.Read(p) }
func (w stdioWire) Write(p []byte) (int, error) { return w.out.Write(p) }

func (w stdioWire) Close() error {
	return errors.Join(w.in.Close(), w.out.Close())
}
