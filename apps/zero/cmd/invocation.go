package cmd

import (
	"errors"
	"fmt"
	"strings"

	"github.com/flexdinesh/zero/internal/daemon"
	"github.com/flexdinesh/zero/internal/desktopapp"
)

// cliName is presentation only. Its zero value keeps constructors and direct
// runners canonical; Execute selects the invoked basename at composition.
type cliName string

func (name cliName) String() string {
	if name == "" {
		return "zero"
	}
	return string(name)
}

func (name cliName) installHint(goos string) string {
	hint := desktopapp.InstallHint(goos)
	if name.String() == "zero" {
		return hint
	}
	hint = strings.Replace(hint, "`zero browser`", "`"+name.String()+" browser`", 1)
	return strings.Replace(hint, "| sh\n", "| sh -s -- --name "+name.String()+"\n", 1)
}

// explainError adapts known local recovery instructions while preserving the
// underlying error for errors.Is/As. Product and daemon identity stay canonical.
func (name cliName) explainError(err error) error {
	if err == nil || name.String() == "zero" {
		return err
	}
	message := ""
	var mismatch *daemon.ProtocolMismatchError
	switch {
	case errors.Is(err, errNoUI):
		message = fmt.Sprintf("no display here; run `%s <path> --remote` to open this machine's files from your computer", name)
	case errors.Is(err, errRemoteUnavailable):
		message = fmt.Sprintf("the running zero daemon cannot serve remotely; stop it with `%s daemon stop` and run this again", name)
	case errors.As(err, &mismatch):
		message = fmt.Sprintf("zero daemon %s at %s speaks protocol %d; this zero speaks protocol %d. Stop it with `%s daemon stop`, or use a zero build with protocol %d",
			mismatch.DaemonVersion, mismatch.Socket, mismatch.Daemon, mismatch.Client, name, mismatch.Daemon)
	default:
		return err
	}
	return &cliError{cause: err, message: message}
}

type cliError struct {
	cause   error
	message string
}

func (err *cliError) Error() string { return err.message }
func (err *cliError) Unwrap() error { return err.cause }
