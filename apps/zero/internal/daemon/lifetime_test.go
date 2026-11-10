//go:build darwin || linux

package daemon

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestDefaultLifetimeStopsOnItsOwn(t *testing.T) {
	if got, want := DefaultLifetime(), (Lifetime{IdleExit: 30 * time.Minute, FirstWait: 10 * time.Minute, Grace: 5 * time.Minute}); got != want {
		t.Errorf("DefaultLifetime() = %+v, want %+v", got, want)
	}
}

func TestLifetimeZeroWaitsNeverFire(t *testing.T) {
	lifetime, timers, fired := newLifetime()
	lifetime.start(0, 0)
	lifetime.join()
	lifetime.leave()
	if len(timers.timers) != 0 || *fired != 0 {
		t.Errorf("zero waits started %d timers and fired %d times", len(timers.timers), *fired)
	}
}

func TestRunRejectsANegativeLifetime(t *testing.T) {
	config := daemonConfig(t)
	for _, lifetime := range []Lifetime{{IdleExit: -time.Second}, {FirstWait: -time.Second}, {Grace: -time.Second}} {
		config.Lifetime = lifetime
		if err := Run(context.Background(), config); err == nil {
			t.Errorf("Run(%+v) = nil, want an error", lifetime)
		}
	}
}

// A start that names no waits takes the daemon's: a zero lifetime keeps the
// listener with no UI, a set one closes it.
func TestRemoteStartUsesTheDaemonLifetime(t *testing.T) {
	for _, test := range []struct {
		name      string
		lifetime  Lifetime
		listening bool
	}{
		{"never", Lifetime{}, true},
		{"first wait", Lifetime{FirstWait: 50 * time.Millisecond, Grace: time.Hour}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := daemonConfig(t)
			config.Lifetime = test.lifetime
			config.IdentityFile = filepath.Join(t.TempDir(), "identity.json")
			daemon := startDaemon(t, config)
			startRemote(t, daemon, "", "")
			time.Sleep(300 * time.Millisecond)
			status, err := daemon.client.RemoteStatus(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if status.Listening != test.listening {
				t.Errorf("listening = %t, want %t", status.Listening, test.listening)
			}
		})
	}
}
