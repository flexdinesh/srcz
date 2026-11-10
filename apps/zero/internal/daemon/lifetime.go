package daemon

import (
	"errors"
	"time"
)

// Lifetime is when a daemon stops on its own. A zero duration never stops:
// Lifetime{} serves until its context ends, so whoever started it, such as a
// container runtime, decides when it stops (decision 0125).
type Lifetime struct {
	// IdleExit stops the daemon after this long with no request in flight.
	IdleExit time.Duration
	// FirstWait closes a remote listener no UI has reached for this long.
	FirstWait time.Duration
	// Grace closes a remote listener this long after its last UI leaves.
	Grace time.Duration
}

// DefaultLifetime is a daemon started on demand (decisions 0061, 0098).
func DefaultLifetime() Lifetime {
	return Lifetime{IdleExit: DefaultIdleExit, FirstWait: DefaultRemoteFirstWait, Grace: DefaultRemoteGrace}
}

func (l Lifetime) validate() error {
	if l.IdleExit < 0 || l.FirstWait < 0 || l.Grace < 0 {
		return errors.New("daemon: lifetime durations must be zero or greater")
	}
	return nil
}
