package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/flexdinesh/zero/internal/desktopapp"
	"github.com/flexdinesh/zero/pkg/connection"
	"github.com/flexdinesh/zero/pkg/contract"
	"github.com/spf13/cobra"
)

const serverCLIHint = "If Zero is installed under another command name on the server, substitute that name for zero there."

type connectOptions struct {
	cliName cliName
	text    string
	host    string
	noOpen  bool
}

// connectDeps are the effects `zero connect` uses; tests replace them.
type connectDeps struct {
	goos      string
	getenv    func(string) string
	terminal  func(io.Writer) bool
	probe     func(context.Context, connection.TLS) (connection.TLS, contract.RemoteInfo, error)
	storePath func() (string, error)
	installed func(context.Context) (bool, error)
	openApp   func(context.Context, string) error
	now       func() time.Time
}

func defaultConnectDeps() connectDeps {
	return connectDeps{
		goos:      runtime.GOOS,
		getenv:    os.Getenv,
		terminal:  isTerminal,
		probe:     connection.Probe,
		storePath: connection.DefaultStorePath,
		installed: desktopapp.Installed,
		openApp:   desktopapp.Open,
		now:       time.Now,
	}
}

func newConnectCommand() *cobra.Command {
	var opts connectOptions
	command := &cobra.Command{
		Use:           "connect <string>",
		Short:         "Open a server started with zero --remote in the desktop app",
		Long:          "Open a server started with zero --remote in the desktop app.\n" + serverCLIHint,
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			opts.cliName = cliName(command.Root().Name())
			opts.text = args[0]
			return runConnect(command.Context(), opts, command.OutOrStdout(), command.ErrOrStderr(), defaultConnectDeps())
		},
	}
	command.Flags().StringVar(&opts.host, "host", "", "connect through this address instead, such as localhost for an ssh tunnel")
	command.Flags().BoolVar(&opts.noOpen, "no-open", false, "save the connection and print its link instead of opening it")
	return command
}

// runConnect checks the server answers to the string, saves the connection,
// and opens it. The link names the connection; the secret stays in the store.
func runConnect(ctx context.Context, opts connectOptions, stdout, stderr io.Writer, deps connectDeps) error {
	endpoint, err := connection.Parse(opts.text)
	if err != nil {
		return errors.New("not a zero connection string: expected the host:port/credential that `zero <path> --remote` prints\n" + serverCLIHint)
	}
	if opts.host != "" {
		host, err := connection.ParseHost(opts.host)
		if err != nil {
			return fmt.Errorf("--host: %w", err)
		}
		endpoint.Hosts = []string{host}
	}
	working, info, err := deps.probe(ctx, endpoint)
	if err != nil {
		return connectFailure(err, endpoint, opts.cliName)
	}
	path, err := deps.storePath()
	if err != nil {
		return err
	}
	saved := connection.Saved{
		ID:      working.Credential.ID(),
		Label:   info.Name,
		AddedAt: deps.now().UTC().Truncate(time.Second),
		TLS:     &connection.SavedTLS{Hosts: working.Hosts, Port: working.Port, Credential: working.Credential.Encode()},
	}
	if err := connection.NewStore(path).Put(saved); err != nil {
		return err
	}

	target := "zero://" + saved.ID + "/"
	link := hyperlink(target, deps.terminal(stdout) && deps.getenv("TERM") != "dumb")
	connected := func() {
		_, _ = fmt.Fprintf(stdout, "connected to %s (zero %s)\ndesktop: %s\n", info.Name, info.Version, link)
	}
	if opts.noOpen {
		connected()
		return nil
	}
	unavailable := func(notice string) error {
		_, _ = fmt.Fprintf(stderr, "%s\n%s", notice, opts.cliName.installHint(deps.goos))
		web, err := working.WebURL()
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(stdout, "connected to %s (zero %s)\nweb: %s\n", info.Name, info.Version, web)
		return nil
	}
	if deps.goos == "linux" {
		installed, err := deps.installed(ctx)
		if err != nil {
			return unavailable(fmt.Sprintf("could not detect the zero desktop app (%v)", err))
		}
		if !installed {
			return unavailable(desktopapp.ErrNotInstalled.Error())
		}
	}
	if err := deps.openApp(ctx, target); err != nil {
		if errors.Is(err, desktopapp.ErrNotInstalled) {
			return unavailable(desktopapp.ErrNotInstalled.Error())
		}
		return unavailable(fmt.Sprintf("could not open the zero desktop app (%v)", err))
	}
	connected()
	return nil
}

// connectFailure says which of the three things went wrong and what to do.
func connectFailure(err error, endpoint connection.TLS, name cliName) error {
	hosts := strings.Join(endpoint.Hosts, ", ")
	switch {
	case errors.Is(err, connection.ErrFingerprint):
		return fmt.Errorf("the server at %s has a different identity: its credential was rotated, or something else answers there. Run `zero <path> --remote` on it and use the new string\n%s", hosts, serverCLIHint)
	case errors.Is(err, connection.ErrToken):
		return fmt.Errorf("the server at %s refused this string's token. Run `zero <path> --remote` on it and use the new string\n%s", hosts, serverCLIHint)
	case errors.Is(err, connection.ErrUnreachable):
		return fmt.Errorf(`could not reach %s on port %d.
Check `+"`zero remote status`"+` on the server: it stops when no UI needs it, so `+"`zero <path> --remote`"+` may need to run again.
A firewall may block the port. To tunnel instead:
  ssh -L %d:localhost:%d <server>
  %s connect <string> --host localhost
%s`, hosts, endpoint.Port, endpoint.Port, endpoint.Port, name, serverCLIHint)
	}
	return err
}
