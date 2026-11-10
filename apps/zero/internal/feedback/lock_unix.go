//go:build darwin || linux

package feedback

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

// lockFile takes an exclusive flock on name, creating it 0600, and returns
// its release. Each call opens its own descriptor, so goroutines of one
// process exclude each other as other processes do.
func lockFile(name string) (func(), error) {
	file, err := os.OpenFile(name, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open feedback lock: %w", err)
	}
	for {
		err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX)
		if !errors.Is(err, syscall.EINTR) {
			break
		}
	}
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("lock feedback: %w", err)
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, nil
}
