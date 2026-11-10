//go:build !darwin && !linux

package feedback

import (
	"fmt"
	"os"
	"sync"
)

// locks stand in for flock where zero has no daemon (decision 0061): they
// serialize writers within one process only, one mutex per lock file.
var locks sync.Map

// lockFile creates name 0600 and serializes callers within this process.
func lockFile(name string) (func(), error) {
	file, err := os.OpenFile(name, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open feedback lock: %w", err)
	}
	_ = file.Close()
	value, _ := locks.LoadOrStore(name, &sync.Mutex{})
	mu, ok := value.(*sync.Mutex)
	if !ok {
		return nil, fmt.Errorf("lock feedback: %s", name)
	}
	mu.Lock()
	return mu.Unlock, nil
}
