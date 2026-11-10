package cmd

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/flexdinesh/zero/internal/attach"
	"github.com/flexdinesh/zero/internal/sandbox"
	"github.com/flexdinesh/zero/internal/version"
	"github.com/flexdinesh/zero/pkg/connection"
	"github.com/spf13/cobra"
)

// newConnectionCommand builds the hidden `zero connection`, which the desktop
// app runs (decision 0128).
func newConnectionCommand() *cobra.Command {
	command := &cobra.Command{
		Use:           "connection",
		Short:         "Saved connections, for the desktop app",
		Hidden:        true,
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	command.AddCommand(&cobra.Command{
		Use:           "stdio <id>",
		Short:         "Serve a saved sandbox connection on standard input and output",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			return connectionStdio(command.Context(), args[0], os.Stdin, os.Stdout, os.Stderr, connection.DefaultStorePath)
		},
	})
	return command
}

// connectionStdio installs zero in a saved sandbox and runs it there on this
// process's standard input and output. zero there deletes itself when it
// stops, so every run installs it again.
func connectionStdio(ctx context.Context, id string, stdin io.Reader, stdout, stderr io.Writer, storePath func() (string, error)) error {
	path, err := storePath()
	if err != nil {
		return err
	}
	saved, found, err := connection.NewStore(path).Lookup(id)
	if err != nil {
		return err
	}
	if !found || saved.Sandbox == nil {
		return fmt.Errorf("no saved sandbox connection %s", id)
	}
	env, err := sandbox.Open(saved.Sandbox.Provider, saved.Sandbox.Ref)
	if err != nil {
		return err
	}
	endpoint, err := attach.Attach(ctx, env, saved.Sandbox.Path, version.Number())
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, endpoint.Argv[0], endpoint.Argv[1:]...)
	cmd.Env = endpoint.Env
	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, stdout, stderr
	return cmd.Run()
}
