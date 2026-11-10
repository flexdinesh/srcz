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
	"github.com/flexdinesh/zero/internal/desktopapp"
	"github.com/flexdinesh/zero/internal/projects"
	"github.com/flexdinesh/zero/internal/runtime"
	"github.com/flexdinesh/zero/internal/sandbox"
	"github.com/flexdinesh/zero/internal/stdio"
	"github.com/flexdinesh/zero/internal/version"
	"github.com/flexdinesh/zero/pkg/connection"
	"github.com/flexdinesh/zero/pkg/contract"
	"github.com/spf13/cobra"
)

// attachHost is where `zero attach` serves the browser: this machine only.
const attachHost = "127.0.0.1"

type attachOptions struct {
	cliName cliName
	target  string
	port    int
	portSet bool
	noOpen  bool
	browser bool
}

// newAttachCommand builds `zero attach <target>` (decisions 0127, 0128).
func newAttachCommand(runAttach func(context.Context, attachOptions, io.Writer, io.Writer) error) *cobra.Command {
	var opts attachOptions
	command := &cobra.Command{
		Use:   "attach <target>",
		Short: "Open files in a running container in the desktop app, falling back to a web browser",
		Long: "Open files in a running container in the desktop app, falling back to a web browser.\n" +
			"The target is docker://<container>[/path]; without a path, zero serves the container's working directory.\n" +
			"zero copies itself into the container's /tmp/.zero, and removes that copy when it stops.",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			if opts.port < 0 || opts.port > 65535 {
				return errors.New("--port must be between 0 and 65535")
			}
			opts.cliName = cliName(command.Root().Name())
			opts.target = args[0]
			opts.portSet = command.Flags().Changed("port")
			return runAttach(command.Context(), opts, command.OutOrStdout(), command.ErrOrStderr())
		},
	}
	flags := command.Flags()
	flags.BoolVar(&opts.browser, "browser", false, "serve to a web browser instead of opening the desktop app")
	flags.IntVar(&opts.port, "port", 0, "browser mode port (0 asks the OS); defaults to the first free port from 7971 to 7980")
	flags.BoolVar(&opts.noOpen, "no-open", false, "save the connection and print its desktop app link instead of opening it (in browser mode, do not open the browser)")
	return command
}

// attachDeps are the effects `zero attach` uses; tests replace them.
type attachDeps struct {
	goos      string
	getenv    func(string) string
	terminal  func(io.Writer) bool
	storePath func() (string, error)
	installed func(context.Context) (bool, error)
	openApp   func(context.Context, string) error
	now       func() time.Time
	browser   func(context.Context, attachOptions, sandbox.Target, io.Writer, io.Writer) error
}

func defaultAttachDeps() attachDeps {
	return attachDeps{
		goos:      goruntime.GOOS,
		getenv:    os.Getenv,
		terminal:  isTerminal,
		storePath: connection.DefaultStorePath,
		installed: desktopapp.Installed,
		openApp:   desktopapp.Open,
		now:       time.Now,
		browser:   attachInBrowser,
	}
}

// runAttach opens the target in the desktop app, as bare zero opens a path,
// or serves it to the browser: with --browser or --port, on a machine with no
// UI, or when the app is not there.
func runAttach(ctx context.Context, opts attachOptions, stdout, stderr io.Writer) error {
	return attachWith(ctx, opts, stdout, stderr, defaultAttachDeps())
}

func attachWith(ctx context.Context, opts attachOptions, stdout, stderr io.Writer, deps attachDeps) error {
	target, err := sandbox.ParseTarget(opts.target)
	if err != nil {
		return err
	}
	if opts.browser || opts.portSet || noUI(deps.goos, deps.getenv) || (deps.goos != "darwin" && deps.goos != "linux") {
		return deps.browser(ctx, opts, target, stdout, stderr)
	}
	return attachInDesktop(ctx, opts, target, stdout, stderr, deps)
}

// attachInDesktop checks zero runs in the target, saves the sandbox
// connection, and opens it in the desktop app, which runs `zero connection
// stdio <id>` for it (decision 0128). It does not stay running.
func attachInDesktop(ctx context.Context, opts attachOptions, target sandbox.Target, stdout, stderr io.Writer, deps attachDeps) error {
	fallback := func(notice string) error {
		_, _ = fmt.Fprintf(stderr, "%s; serving in browser mode\n", notice)
		_, _ = io.WriteString(stderr, opts.cliName.installHint(deps.goos))
		return deps.browser(ctx, opts, target, stdout, stderr)
	}
	if !opts.noOpen && deps.goos == "linux" {
		installed, err := deps.installed(ctx)
		if err != nil {
			return fallback(fmt.Sprintf("could not detect the zero desktop app (%v)", err))
		}
		if !installed {
			return fallback(desktopapp.ErrNotInstalled.Error())
		}
	}

	info, err := probeSandbox(ctx, target, stdout)
	if err != nil {
		return err
	}
	ref, engine, err := target.Environment.Identity(ctx)
	if err != nil {
		return err
	}
	path, err := deps.storePath()
	if err != nil {
		return err
	}
	saved := connection.Saved{
		ID:      connection.SandboxID(target.Provider, engine, ref),
		Label:   target.String(),
		AddedAt: deps.now().UTC().Truncate(time.Second),
		Sandbox: &connection.SavedSandbox{Provider: target.Provider, Ref: ref, Path: target.Path},
	}
	if err := connection.NewStore(path).Put(saved); err != nil {
		return err
	}

	link := "zero://" + saved.ID + "/"
	attached := func() {
		_, _ = fmt.Fprintf(stdout, "attached to %s (zero %s on %s)\ndesktop: %s\n", saved.Label, info.Version, info.Name, hyperlink(link, deps.terminal(stdout) && deps.getenv("TERM") != "dumb"))
	}
	if opts.noOpen {
		attached()
		return nil
	}
	if err := deps.openApp(ctx, link); err != nil {
		if errors.Is(err, desktopapp.ErrNotInstalled) {
			return fallback(desktopapp.ErrNotInstalled.Error())
		}
		return fallback(fmt.Sprintf("could not open the zero desktop app (%v)", err))
	}
	attached()
	return nil
}

// probeSandbox installs zero in target and asks it to describe itself, so a
// failure shows here rather than in the app. It returns once that zero has
// exited: it deletes its binary then, which must not race the app's install.
func probeSandbox(ctx context.Context, target sandbox.Target, stdout io.Writer) (contract.RemoteInfo, error) {
	endpoint, err := installInSandbox(ctx, target, stdout)
	if err != nil {
		return contract.RemoteInfo{}, err
	}
	transport := endpoint.Transport()
	defer func() { _ = transport.Close() }()
	return transport.Connect(ctx)
}

func installInSandbox(ctx context.Context, target sandbox.Target, stdout io.Writer) (connection.Exec, error) {
	output := terminalWriter(stdout)
	_, _ = fmt.Fprint(output, "  ")
	_, _ = color.New(color.Faint).Fprintf(output, "installing zero in %s\n", target)
	return attach.Attach(ctx, target.Environment, target.Path, version.Number())
}

// attachInBrowser installs zero in the target, runs it there, and serves it
// to the browser on attachHost until ctx ends.
func attachInBrowser(ctx context.Context, opts attachOptions, target sandbox.Target, stdout, stderr io.Writer) error {
	endpoint, err := installInSandbox(ctx, target, stdout)
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
