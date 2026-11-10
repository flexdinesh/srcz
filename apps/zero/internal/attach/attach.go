// Package attach runs zero in a sandbox and returns the way to reach it
// (decision 0127): install zero there, then run `zero serve-stdio <path>` on
// the command's standard input and output. It knows no one provider.
package attach

import (
	"context"
	"fmt"
	"path"
	"slices"

	"github.com/flexdinesh/zero/internal/sandbox"
	"github.com/flexdinesh/zero/pkg/connection"
)

// platforms are where zero releases run.
var platforms = []string{"linux/amd64", "linux/arm64"}

// Attach installs zero version in env and returns the endpoint that serves
// dir there. The endpoint starts zero on first use, and again if it exits.
func Attach(ctx context.Context, env sandbox.Environment, dir, version string) (connection.Exec, error) {
	platform, err := env.Platform(ctx)
	if err != nil {
		return connection.Exec{}, err
	}
	if !slices.Contains(platforms, platform) {
		return connection.Exec{}, fmt.Errorf("zero has no build for %s; it runs on linux/amd64 and linux/arm64", platform)
	}
	binary, err := env.Install(ctx, version)
	if err != nil {
		return connection.Exec{}, err
	}
	// zero's directory is its HOME: user state stays beside it, writable by
	// the user it runs as.
	cmd, err := env.Exec(ctx, []string{binary, "serve-stdio", "--", dir}, []string{"HOME=" + path.Dir(binary)})
	if err != nil {
		return connection.Exec{}, err
	}
	return connection.Exec{Argv: append([]string{cmd.Path}, cmd.Args[1:]...), Env: cmd.Env}, nil
}
